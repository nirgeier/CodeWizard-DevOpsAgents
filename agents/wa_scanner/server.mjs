/**
 * WhatsApp Job Scanner - HTTP + SSE server.
 *
 * Exposes a JSON API on top of the Baileys session:
 *   - Live QR pairing (SSE stream for browser display)
 *   - Session start/stop/status
 *   - Group listing (to pick job groups)
 *   - Message history fetching + reading
 *   - Job extraction from messages
 *
 * Run:  node server.mjs          (from agents/wa_scanner/)
 *       PORT=8789 HOST=127.0.0.1 WA_TOKEN=secret node server.mjs
 *
 * Security: binds to 127.0.0.1 by default. If WA_TOKEN is set, every
 * /api call and the SSE stream require it (Bearer token or HttpOnly cookie).
 */
import http from 'http'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WASession, toJid } from './wa.mjs'

process.on('unhandledRejection', (e) => console.log('[unhandledRejection]', e?.message || e))
process.on('uncaughtException', (e) => console.log('[uncaughtException]', e?.message || e))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..') // repo root
const AUTH_DIR = path.join(__dirname, 'auth_info')

const PORT = Number(process.env.PORT || 8789)
const HOST = process.env.HOST || '127.0.0.1'
const ADMIN_TOKEN = process.env.WA_TOKEN || ''

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const session = new WASession({ authDir: AUTH_DIR })

const sendJson = (res, code, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

const readBody = (req, limit = 1_000_000) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy() }
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const parseJsonBody = async (req, limit) => {
  const raw = await readBody(req, limit)
  if (!raw.trim()) return {}
  try { return JSON.parse(raw) } catch { throw new Error('invalid JSON body') }
}

const COOKIE = 'wa_scanner_token'
const tokenOk = (req, res) => {
  if (!ADMIN_TOKEN) return true
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))
  const val = header || (cookie ? decodeURIComponent(cookie.slice(COOKIE.length + 1)) : '')
  return Boolean(val) && val === ADMIN_TOKEN
}

// SSE fan-out
const sseClients = new Set()
const broadcast = (event, data) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of [...sseClients]) {
    try { res.write(frame) } catch { sseClients.delete(res) }
  }
}
session.onEvent((type, data) => broadcast(type, data))

const router = new Map()

router.set('GET /api/status', async (req, res) => {
  let paired = false
  let me = null
  try {
    const raw = await fs.readFile(path.join(AUTH_DIR, 'creds.json'), 'utf8')
    const creds = JSON.parse(raw)
    paired = Boolean(creds.me)
    me = creds.me || null
  } catch { /* not paired yet */ }
  // Don't call getGroups() on every status request - it's slow
  // Use snapshot size if available, or 0
  const groupsCount = session.snapshot?.size || 0
  sendJson(res, 200, {
    ok: true,
    app: 'whatsapp-job-scanner',
    paired,
    me: me ? `${me.id} (${me.name || ''})` : null,
    phase: session.state.phase,
    connection: session.state.connection,
    closeReason: session.state.closeReason || null,
    qrSeq: session.state.qrSeq || 0,
    groupsCount,
    messages: session.messagesInfo(),
    authDir: AUTH_DIR,
  })
})

router.set('POST /api/session/start', async (req, res) => {
  const body = await parseJsonBody(req)
  if (body.disconnect === true) { await session.disconnect(); return sendJson(res, 200, { ok: true }) }
  try {
    await session.ensure()
    await session.start()
    return sendJson(res, 200, { ok: true, paired: session.isPaired(), phase: session.state.phase })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) })
  }
})

router.set('POST /api/session/stop', async (req, res) => {
  await session.disconnect()
  sendJson(res, 200, { ok: true })
})

router.set('GET /api/groups', async (req, res) => {
  if (!session.isPaired()) return sendJson(res, 409, { ok: false, error: 'session is not paired' })
  try {
    const groups = await session.getGroups()
    sendJson(res, 200, { ok: true, groups, count: groups.length })
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err) })
  }
})

router.set('POST /api/groups/monitor', async (req, res) => {
  if (!session.isPaired()) return sendJson(res, 409, { ok: false, error: 'session is not paired' })
  const body = await parseJsonBody(req)
  const { jids } = body
  if (!Array.isArray(jids)) return sendJson(res, 400, { ok: false, error: 'jids array required' })
  const added = []
  for (const j of jids) {
    const jid = j.includes('@') ? j : `${j}@g.us`
    session.jobGroupJids.add(jid)
    added.push(jid)
  }
  sendJson(res, 200, { ok: true, monitored: Array.from(session.jobGroupJids), added })
})

router.set('POST /api/groups/unmonitor', async (req, res) => {
  const body = await parseJsonBody(req)
  const { jids } = body
  if (!Array.isArray(jids)) return sendJson(res, 400, { ok: false, error: 'jids array required' })
  const removed = []
  for (const j of jids) {
    const jid = j.includes('@') ? j : `${j}@g.us`
    if (session.jobGroupJids.delete(jid)) removed.push(jid)
  }
  sendJson(res, 200, { ok: true, monitored: Array.from(session.jobGroupJids), removed })
})

router.set('GET /api/messages', async (req, res) => {
  if (!session.isPaired()) return sendJson(res, 409, { ok: false, error: 'session is not paired' })
  const p = new URL(req.url, 'http://x').searchParams
  const r = session.listMessages({
    jid: p.get('jid') || undefined,
    limit: p.get('limit') ? Number(p.get('limit')) : 200,
    since: p.get('since') ? Number(p.get('since')) : undefined,
    until: p.get('until') ? Number(p.get('until')) : undefined,
    q: p.get('q') || undefined,
    minText: p.get('minText') ? Number(p.get('minText')) : 0,
    fromMe: p.get('fromMe') === null ? undefined : p.get('fromMe') === 'true',
  })
  sendJson(res, 200, { ok: true, ...r, store: session.messagesInfo() })
})

router.set('POST /api/groups/history', async (req, res) => {
  if (!session.isPaired()) return sendJson(res, 409, { ok: false, error: 'session is not paired' })
  const body = await parseJsonBody(req)
  const { jid, count, waitMs } = body
  if (!jid) return sendJson(res, 400, { ok: false, error: 'jid required' })
  try {
    const r = await session.fetchHistory(jid, count || 50, { waitMs: waitMs || 20000 })
    sendJson(res, 200, { ok: true, ...r })
  } catch (err) {
    sendJson(res, 400, { ok: false, error: String(err?.message || err) })
  }
})

router.set('POST /api/groups/join', async (req, res) => {
  if (!session.isPaired()) return sendJson(res, 409, { ok: false, error: 'session is not paired' })
  const body = await parseJsonBody(req)
  const { code } = body
  if (!code) return sendJson(res, 400, { ok: false, error: 'code required (part after chat.whatsapp.com/)' })
  try {
    const jid = await session.joinByInvite(code)
    return sendJson(res, 200, { ok: true, jid, link: `https://chat.whatsapp.com/${String(code).trim()}` })
  } catch (err) {
    const msg = String(err?.message || err)
    return sendJson(res, 400, { ok: false, error: msg })
  }
})

router.set('POST /api/scan/extract-jobs', async (req, res) => {
  if (!session.isPaired()) return sendJson(res, 409, { ok: false, error: 'session is not paired' })
  const body = await parseJsonBody(req)
  const { jid, since, limit = 100 } = body
  if (!jid) return sendJson(res, 400, { ok: false, error: 'jid required' })

  // Fetch recent messages if requested
  if (since) {
    await session.fetchHistory(jid, limit, { waitMs: 15000 })
  }

  const { messages } = session.listMessages({ jid, limit: Number(limit), since: since ? Number(since) : undefined, minText: 10 })
  const jobs = extractJobsFromMessages(messages, jid)
  sendJson(res, 200, { ok: true, jid, scanned: messages.length, jobs })
})

router.set('POST /api/login', async (req, res) => {
  const body = await parseJsonBody(req)
  if (body.token && body.token === ADMIN_TOKEN) {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': `${COOKIE}=${encodeURIComponent(body.token)}; HttpOnly; SameSite=Strict; Path=/`,
      'cache-control': 'no-store',
    })
    return res.end(JSON.stringify({ ok: true }))
  }
  sendJson(res, 401, { ok: false, error: 'wrong token' })
})

router.set('POST /api/logout', async (req, res) => {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  })
  res.end(JSON.stringify({ ok: true }))
})

// SSE event stream - drives pairing + live updates in the browser
router.set('GET /api/events', async (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  res.write('retry: 2000\n\n')
  sseClients.add(res)
  const groups = await session.getGroups()
  res.write(`event: state\ndata: ${JSON.stringify(session.state)}\n\n`)
  res.write(`event: status\ndata: ${JSON.stringify({ paired: session.isPaired(), groupsCount: groups.length })}\n\n`)
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch { /* closed */ } }, 25000)
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res) })
})

async function serveStatic(url, res) {
  let p = decodeURIComponent(url)
  if (p === '/' || p === '') p = '/index.html'
  const file = path.join(__dirname, p)
  if (!file.startsWith(__dirname)) { res.writeHead(403).end('forbidden'); return }
  try {
    const data = await fs.readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const key = `${req.method} ${url.pathname}`
  const route = router.get(key)
  try {
    if (route) {
      const isAuthRoute = key === 'POST /api/login' || key === 'POST /api/logout'
      if (!isAuthRoute && !tokenOk(req, res)) return sendJson(res, 401, { ok: false, error: 'unauthorized - visit /login' })
      return await route(req, res)
    }
    if (req.method === 'GET' && key.startsWith('GET /api/')) {
      if (!tokenOk(req, res)) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return sendJson(res, 404, { ok: false, error: 'unknown api route' })
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    if (req.method === 'GET') return await serveStatic(url.pathname, res)
    return sendJson(res, 404, { ok: false, error: 'not found' })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) })
  }
})

server.listen(PORT, HOST, () => {
  const scheme = ADMIN_TOKEN ? '' : '  (NO TOKEN - bind to localhost only)'
  console.log(`WhatsApp Job Scanner: http://${HOST}:${PORT}/`)
  console.log(`  session dir: ${AUTH_DIR}`)
  console.log(`  auth: ${ADMIN_TOKEN ? 'token required' : 'none'}${scheme}`)
  if (!ADMIN_TOKEN && HOST !== '127.0.0.1') {
    console.warn('\n  WARNING: running without WA_TOKEN on a non-localhost interface.')
  }
})

/** Extract job postings from WhatsApp messages. */
function extractJobsFromMessages(messages, groupJid) {
  const jobs = []
  const jobKeywords = [
    'devops', 'dev ops', 'devsecops',
    'site reliability', 'sre',
    'platform engineer', 'platform engineering',
    'infrastructure engineer', 'cloud engineer',
    'kubernetes', 'k8s', 'terraform', 'gitops',
    'argocd', 'ci/cd', 'cicd', 'observability',
    'prometheus', 'grafana', 'openshift',
    'docker', 'ansible', 'jenkins', 'helm',
    'aws', 'eks', 'gke', 'gcp', 'azure',
    'linux', 'networking', 'cloud',
    'build engineer', 'release engineer', 'systems engineer',
    'system administrator', 'sysadmin',
  ]

  for (const m of messages) {
    const text = (m.text || '').toLowerCase()
    const hasJobKeyword = jobKeywords.some(kw => text.includes(kw))
    if (!hasJobKeyword) continue

    // Try to extract structured info
    const lines = m.text.split('\n').map(l => l.trim()).filter(Boolean)
    const title = lines[0] || 'WhatsApp Job Post'
    const company = extractCompany(lines)
    const location = extractLocation(lines)

    jobs.push({
      external_id: m.id,
      source: 'whatsapp',
      title,
      company,
      company_domain: null,
      location,
      city: null,
      country: 'IL',
      work_mode: null,
      employment: null,
      seniority: extractSeniority(text),
      department: null,
      url: null,
      description: m.text,
      posted_at: new Date(m.ts).toISOString(),
      posted_text: null,
      keywords: jobKeywords.filter(kw => text.includes(kw)),
      tags: ['whatsapp', groupJid],
      score: calculateScore(text, jobKeywords),
      is_devops: true,
      raw: { whatsapp: { jid: m.jid, author: m.author, pushName: m.pushName, ts: m.ts, kind: m.kind, groupJid } },
    })
  }
  return jobs
}

function extractCompany(lines) {
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes('company') || lower.includes('חברה') || lower.match(/^@\w+/)) {
      return line.replace(/^[@#]\s*/, '').slice(0, 100)
    }
  }
  return null
}

function extractLocation(lines) {
  const ilCities = ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'פתח תקווה', 'נתניה', 'רמת גן', 'חולון', 'הרצליה', 'רעננה', 'כפר סבא', 'מודיעין', 'גבעתיים', 'בת ים', 'אשדוד', 'אשקלון', 'רחובות', 'נס ציונה', 'הוד השרון', 'קריית', 'יבנה', 'לוד', 'רמלה']
  for (const line of lines) {
    for (const city of ilCities) {
      if (line.includes(city)) return city
    }
    if (/^(tel aviv|jerusalem|haifa|beer sheva|rishon|petah tikva|netanya|ramat gan|holon|herzliya|raanana|kfar saba|modiin|givatayim|bat yam|ashdod|ashkelon|rehovot|nes ziona|hod hasharon|kiryat|yevne|lod|ramla)/i.test(line)) {
      return line
    }
  }
  return 'Israel'
}

function extractSeniority(text) {
  if (text.includes('junior') || text.includes('ג\'וניור') || text.includes('ללא נסיון') || text.includes('סטודנט')) return 'junior'
  if (text.includes('senior') || text.includes('סיניור') || text.includes('5-6 שנים') || text.includes('6+') || text.includes('מומחה')) return 'senior'
  if (text.includes('lead') || text.includes('ראש צוות') || text.includes('team lead') || text.includes('tech lead')) return 'lead'
  if (text.includes('principal') || text.includes('ארכיטקט') || text.includes('architect')) return 'principal'
  if (text.includes('head') || text.includes('director') || text.includes('vp') || text.includes('מנהל')) return 'head'
  return null
}

function calculateScore(text, keywords) {
  let score = 0
  for (const kw of keywords) {
    if (text.includes(kw)) score += 0.05
  }
  return Math.min(0.99, Math.max(0.1, score))
}