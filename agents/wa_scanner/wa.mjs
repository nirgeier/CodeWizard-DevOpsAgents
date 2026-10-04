/**
 * WASession - Baileys session manager for WhatsApp job scanning.
 *
 * Manages a personal WhatsApp account connection via Baileys:
 * - QR pairing (streamed via SSE for browser display)
 * - Credential persistence (auth_info directory)
 * - Group monitoring for job postings
 * - Message capture (text + media captions) for job extraction
 *
 * Uses the patched @whiskeysockets/baileys from the parent repo.
 */
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs'

const silentLog = {
  level: 'silent',
  child: () => silentLog,
  trace() {}, debug() {}, info() {}, warn() {}, error() {},
}

const RECONNECT_DELAY_MS = 5000
const MAX_RECONNECT_ATTEMPTS = 3
const MAX_MESSAGES = 50000

/** Convert various phone formats to WhatsApp JID. */
export function toJid(input) {
  const s = String(input).trim()
  if (s.includes('@')) return s
  let d = s.replace(/[^0-9]/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '972' + d.slice(1)
  return `${d}@s.whatsapp.net`
}

export function jidToPhone(jid) {
  const m = /^(\d+)@s\.whatsapp\.net$/.exec(jid)
  return m ? m[1] : jid
}

export class WASession {
  constructor({ authDir, jobGroupJids = [] }) {
    this.authDir = authDir
    this.jobGroupJids = new Set(jobGroupJids.filter(Boolean).map(j => j.includes('@') ? j : `${j}@g.us`))
    this.sock = null
    this.creds = null
    this.saveCreds = null
    this.state = { phase: 'idle', connection: null, lastDisconnect: null, error: null, qrSeq: 0 }
    this.listeners = new Set()
    this.messages = new Map()
    this._msgQueue = []
    this._msgTimer = null
    this.messagesLoaded = false
    this._stopReconnect = false
    this._reconnecting = false
    this.snapshot = new Map() // group jid -> group info
  }

  onEvent(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(type, data) {
    for (const fn of [...this.listeners]) {
      try { fn(type, data) } catch { /* ignore */ }
    }
  }

  setPhase(phase, extra = {}) {
    this.state = { ...this.state, ...extra, phase }
    this.emit('state', { ...this.state })
  }

  isPaired() {
    return Boolean(this.creds?.me)
  }

  /** Where captured messages are persisted. */
  messagesFile() {
    return join(dirname(this.authDir), 'data', 'wa_messages.ndjson')
  }

  /** Load persisted messages on startup. */
  loadMessages() {
    this.messages.clear()
    let raw = ''
    try { raw = readFileSync(this.messagesFile(), 'utf8') } catch { return 0 }
    let n = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const m = JSON.parse(line)
        if (!m?.id) continue
        if (typeof m.ts === 'number' && m.ts > 0 && m.ts < 1e12) m.ts = m.ts * 1000
        this.messages.set(m.id, m)
        n++
      } catch { /* skip torn line */ }
    }
    while (this.messages.size > MAX_MESSAGES) {
      this.messages.delete(this.messages.keys().next().value)
    }
    this.messagesLoaded = true
    return n
  }

  /** Batched append of captured messages. */
  flushMessages() {
    if (!this._msgQueue.length) return
    const batch = this._msgQueue.splice(0, this._msgQueue.length)
    clearTimeout(this._msgTimer)
    this._msgTimer = null
    try {
      mkdirSync(dirname(this.messagesFile()), { recursive: true })
      appendFileSync(this.messagesFile(), batch.map(m => JSON.stringify(m)).join('\n') + '\n')
    } catch (err) {
      this.emit('meta', { message: `message store write failed: ${err?.message || err}` })
    }
  }

  /** Normalize a raw Baileys message into a flat record. */
  normalizeMessage(raw, source = 'live') {
    if (!raw?.key?.id) return null
    const key = raw.key
    const msg = raw.message || {}
    const ctx = msg.extendedTextMessage?.contextInfo || msg.imageMessage?.contextInfo || msg.videoMessage?.contextInfo
      || msg.documentMessage?.contextInfo || msg.extendedTextMessage?.extendedTextMessage?.contextInfo || null
    let text = msg.conversation
      || msg.extendedTextMessage?.text
      || msg.imageMessage?.caption
      || msg.videoMessage?.caption
      || msg.documentMessage?.caption
      || msg.buttonsMessage?.contentText
      || msg.templateMessage?.hydratedTemplate?.hydratedContentText
      || ''
    if (Array.isArray(text)) text = text.map(p => p?.text || '').join(' ')
    text = String(text || '').trim()
    let kind = 'text'
    let fileName = null
    if (msg.imageMessage || msg.viewOnceMessage?.message?.imageMessage) kind = 'image'
    else if (msg.videoMessage) kind = 'video'
    else if (msg.documentMessage) { kind = 'document'; fileName = msg.documentMessage.fileName || null }
    else if (msg.audioMessage) kind = 'audio'
    else if (msg.stickerMessage) kind = 'sticker'
    else if (msg.contactMessage || msg.contactsArrayMessage) kind = 'contact'
    else if (msg.locationMessage || msg.liveLocationMessage) kind = 'location'
    else if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3) kind = 'poll'
    else if (!text) kind = 'system'
    const quoted = ctx?.quotedMessage
      ? (ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text || ctx.quotedMessage.imageMessage?.caption || '') || null
      : null
    const rawTs = ts2n(raw.messageTimestamp)
    const ts = rawTs > 1e12 ? rawTs : rawTs * 1000 || Date.now()
    return {
      id: key.id,
      jid: key.remoteJid || null,
      fromMe: Boolean(key.fromMe),
      author: key.participant || key.remoteJid || null,
      pushName: raw.pushName || null,
      ts: ts || Date.now(),
      kind,
      text,
      fileName,
      quoted: quoted ? String(quoted).slice(0, 400) : null,
      forwarded: Boolean(ctx?.forwardingScore || msg.forwarded),
      mentions: (ctx?.mentionedJid || []).slice(0, 10),
      source,
      capturedAt: Date.now(),
    }
  }

  /** Store messages (dedup by id). Only stores messages from monitored job groups. */
  captureMessages(list, source = 'live') {
    let added = 0
    for (const raw of Array.isArray(list) ? list : [list]) {
      const jid = raw?.key?.remoteJid
      if (jid && this.jobGroupJids.size > 0 && !this.jobGroupJids.has(jid)) continue
      const m = this.normalizeMessage(raw, source)
      if (!m) continue
      const prev = this.messages.get(m.id)
      if (prev) { if (!prev.pushName && m.pushName) prev.pushName = m.pushName; continue }
      this.messages.set(m.id, m)
      this._msgQueue.push(m)
      added++
      if (this.messages.size > MAX_MESSAGES) this.messages.delete(this.messages.keys().next().value)
    }
    if (added) {
      if (!this._msgTimer) this._msgTimer = setTimeout(() => this.flushMessages(), 1500)
      this.emit('messages', { added, total: this.messages.size })
    }
    return added
  }

  /** Message-store stats for status endpoint. */
  messagesInfo() {
    if (!this.messagesLoaded) this.loadMessages()
    const groups = new Set()
    for (const m of this.messages.values()) if (m.jid) groups.add(m.jid)
    return { total: this.messages.size, groups: groups.size, file: this.messagesFile() }
  }

  /** Read captured messages, newest last. Filters: jid, since, until, q, minText, fromMe. */
  listMessages({ jid, limit = 200, since, until, q, minText = 0, fromMe } = {}) {
    if (!this.messagesLoaded) this.loadMessages()
    let out = []
    const needle = q ? String(q).toLowerCase() : null
    for (const m of this.messages.values()) {
      if (jid && m.jid !== jid) continue
      if (since && m.ts < Number(since)) continue
      if (until && m.ts > Number(until)) continue
      if (fromMe !== undefined && m.fromMe !== Boolean(fromMe)) continue
      if (minText && (m.text || '').length < Number(minText)) continue
      if (needle && !(m.text || '').toLowerCase().includes(needle)) continue
      out.push(m)
    }
    out.sort((a, b) => a.ts - b.ts)
    const n = Math.max(1, Math.min(Number(limit) || 200, 1000))
    return { count: out.length, returned: out.length > n ? n : out.length, messages: out.slice(-n) }
  }

  /** Ask the phone to push a chat's recent messages (on-demand history sync). */
  async fetchHistory(jid, count = 50, { waitMs = 20000, quietMs = 2500 } = {}) {
    if (!this.sock) throw new Error('not connected')
    if (!this.sock.fetchMessageHistory) throw new Error('fetchMessageHistory unavailable on this socket')
    const before = this.countFor(jid)
    const req = Math.max(1, Math.min(Number(count) || 50, 200))
    await this.sock.fetchMessageHistory(req, { remoteJid: jid, fromMe: false, id: 'cw-job-history' }, Date.now())
    const deadline = Date.now() + Math.max(2000, Number(waitMs) || 20000)
    let seen = before
    let lastAt = Date.now()
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
      const now = this.countFor(jid)
      if (now !== seen) { seen = now; lastAt = Date.now() }
      else if (now > before && Date.now() - lastAt >= quietMs) break
    }
    this.flushMessages()
    return { jid, requested: req, newMessages: this.countFor(jid) - before, total: this.countFor(jid) }
  }

  countFor(jid) {
    let n = 0
    for (const m of this.messages.values()) if (m.jid === jid) n++
    return n
  }

  /** Create the socket and wire event handlers. */
  async ensure() {
    if (this.sock && (this.state.phase !== 'closed' || this.state.connection === 'open' || this.state.connection === 'connecting')) return this.sock
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    this.creds = state.creds
    this.saveCreds = saveCreds
    this.loadMessages()
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }))

    const sock = makeWASocket({
      version,
      auth: state,
      logger: silentLog,
      browser: Browsers.macOS('Desktop'),
      qrTimeout: 120000,
    })
    this.sock = sock

    sock.ev.on('creds.update', (u) => {
      if (u && typeof u === 'object') this.creds = { ...(this.creds || {}), ...u }
      try { saveCreds(u) } catch { /* non-fatal */ }
      if (u?.advSecretKey) this.emit('qr-refresh', { reason: 'adv-secret-rotated' })
    })

    sock.ev.on('connection.update', (u) => {
      this.state = { ...this.state, connection: u.connection ?? this.state.connection, lastDisconnect: u.lastDisconnect ?? this.state.lastDisconnect }
      if (u.qr) this.dispatchQr(u.qr)
      if (u.isNewLogin) this.setPhase(this.isPaired() ? 'open' : 'open', {})
      if (u.connection === 'connecting') this.setPhase('connecting', {})
      if (u.connection === 'open') {
        this.state.closeReason = null
        this.state.error = null
        this.state.reconnectAttempts = 0
        this.setPhase('open', { isNewLogin: Boolean(u.isNewLogin) })
        this._stopReconnect = false
        // Fetch groups and populate snapshot
        this.fetchGroups().catch(() => {})
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode ?? u.lastDisconnect?.error?.message
        this.setPhase('closed', { closeReason: String(code || 'connection closed') })
        this.maybeReconnect()
      }
      this.emit('connection', { connection: u.connection, isNewLogin: Boolean(u.isNewLogin), statusCode: u.lastDisconnect?.error?.output?.statusCode ?? null })
    })

    sock.ev.on('messages.upsert', ({ messages, type } = {}) => {
      if (messages?.length) this.captureMessages(messages, 'live')
    })
    sock.ev.on('messages.delete', () => { /* store keeps what it saw */ })

    sock.ev.on('messaging-history.set', (update) => {
      if (update?.messages?.length) this.captureMessages(update.messages, 'history')
      if (update?.isLatest !== undefined) {} // groups refresh handled externally
    })

    this.sock = sock
    this.setPhase(this.isPaired() ? 'idle' : 'idle', { paired: this.isPaired() })
    return sock
  }

  dispatchQr(qrPayload) {
    this.state.qrSeq = (this.state.qrSeq || 0) + 1
    this.setPhase('pairing', { qrSeq: this.state.qrSeq })
    qrcode.toDataURL(qrPayload, { width: 480, margin: 2 }).then(dataUrl => {
      this.emit('qr', { dataUrl, seq: this.state.qrSeq, prefix: qrPayload.slice(0, 40) })
    }).catch(() => {})
  }

  /** Start the connection (pair if needed, connect otherwise). */
  async start() {
    if (this.state.connection === 'open') return
    this._stopReconnect = false
    await this.ensure()
    // baileys v6 auto-starts on socket creation
    if (typeof this.sock.connect !== 'function') {
      this.emit('meta', { message: 'socket auto-starts (no explicit connect)' })
      return
    }
    try {
      await this.sock.connect({})
      this.emit('meta', { message: 'socket connect requested' })
    } catch (err) {
      this.setPhase('closed', { error: String(err?.message || err) })
    }
  }

  async stop() {
    this._stopReconnect = true
    if (this.sock) {
      try { await this.sock.end() } catch { /* ignore */ }
    }
    this.sock = null
    this.setPhase('idle', {})
  }

  maybeReconnect() {
    if (this._stopReconnect || this._reconnecting || !this.isPaired()) return
    const attempts = this.state.reconnectAttempts ?? 0
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit('state', { ...this.state, phase: 'closed', error: 'reconnect attempts exhausted' })
      return
    }
    this._reconnecting = true
    this.state.reconnectAttempts = attempts + 1
    this.emit('state', { ...this.state, note: `reconnecting in ${RECONNECT_DELAY_MS / 1000}s (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})` })
    setTimeout(async () => {
      this._reconnecting = false
      try { await this.start() } catch { /* leave state as closed */ }
    }, RECONNECT_DELAY_MS)
  }

  async disconnect() {
    this._stopReconnect = true
    if (this.sock) {
      try { await this.sock.end() } catch { /* ignore */ }
    }
    this.sock = null
    this.state.reconnectAttempts = 0
    this.setPhase('idle', { paired: this.isPaired() })
  }

  /** Get list of groups the session is in. */
  async getGroups() {
    if (!this.sock) return []
    try {
      const groups = await this.sock.groupFetchAllParticipating()
      const result = Object.values(groups).map(g => ({
        jid: g.id,
        subject: g.subject || '(no subject)',
        size: g.size || (g.participants?.length || 0),
        participants: g.participants || [],
      }))
      // Update snapshot
      for (const g of result) this.snapshot.set(g.jid, g)
      return result
    } catch {
      return []
    }
  }

  /** Fetch groups and populate snapshot (used on connection open). */
  async fetchGroups() {
    if (!this.sock) return []
    try {
      const groups = await this.sock.groupFetchAllParticipating()
      this.snapshot.clear()
      for (const g of Object.values(groups)) {
        this.snapshot.set(g.id, {
          jid: g.id,
          subject: g.subject || '(no subject)',
          size: g.size || (g.participants?.length || 0),
          participants: g.participants || [],
        })
      }
      this.emit('groups', { status: 'ready', count: this.snapshot.size })
      return [...this.snapshot.values()]
    } catch {
      return []
    }
  }

  /** Get group metadata. */
  async getGroupMetadata(jid) {
    if (!this.sock) throw new Error('not connected')
    return this.sock.groupMetadata(jid)
  }

  /** Join a group via invite code. */
  async joinByInvite(code) {
    if (!this.sock) throw new Error('not connected')
    code = String(code || '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error(`bad invite code "${code}"`)
    return this.sock.groupAcceptInvite(code)
  }
}

/** Long/number/number-string -> number (message timestamps arrive as all three). */
function ts2n(ts) {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'bigint') return Number(ts)
  if (ts && typeof ts.toNumber === 'function') return ts.toNumber()
  const n = Number(ts)
  return Number.isFinite(n) ? n : 0
}