/**
 * WhatsApp session - Baileys socket owned by the Next.js server.
 *
 * The scanner used to be a standalone app on its own port. It now lives inside
 * the webapp so `/whatsapp` is a tab like any other: the socket is created
 * lazily by the first API route that touches it and is stashed on `globalThis`
 * so a dev-server hot reload (which re-evaluates this module) keeps the live
 * connection instead of opening a second one.
 *
 * Handles:
 *   - QR pairing (the QR arrives as `connection.update` and is cached in state,
 *     so a page reload can render it again)
 *   - connect/reconnect with a bounded retry
 *   - credential persistence under `webapp/.wa-session/auth_info`
 *   - live capture of messages from monitored groups
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type WaPhase =
  | "idle"
  | "connecting"
  | "pairing"
  | "open"
  | "closed"
  | "error";

export interface WaGroup {
  jid: string;
  subject: string;
  size: number;
  monitored: boolean;
}

export interface WaMessage {
  id: string;
  jid: string | null;
  fromMe: boolean;
  author: string | null;
  pushName: string | null;
  ts: number;
  kind: string;
  text: string;
  quoted?: string | null;
  groupSubject?: string | null;
}

export interface WaState {
  phase: WaPhase;
  connection: string | null;
  qr: string | null;
  qrSeq: number;
  registered: boolean;
  me: string | null;
  closeReason: string | null;
  lastError: string | null;
  groups: number;
  messages: number;
  newMessages: number;
  startedAt: string | null;
}

const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 5;
/** Cap the on-disk message store so a long-running tab can't fill the disk. */
const MAX_MESSAGES = 20000;
const FLUSH_DEBOUNCE_MS = 1500;

export const WA_SESSION_DIR = path.join(process.cwd(), ".wa-session");
// Overridable so a second session (or a test for the pairing flow) can point at
// its own credential directory without touching the real one.
export const WA_SESSION_DIR = process.env.WA_SESSION_DIR
  ? path.resolve(process.env.WA_SESSION_DIR)
  : path.join(process.cwd(), ".wa-session");
export const WA_AUTH_DIR = path.join(WA_SESSION_DIR, "auth_info");
export const WA_STATE_FILE = path.join(WA_SESSION_DIR, "state.json");
export const WA_MESSAGES_FILE = path.join(WA_SESSION_DIR, "messages.ndjson");

/** Baileys is chatty by design; the tab shows its own state, so keep it quiet. */
function quietLogger() {
  const noop = () => {};
  const logger = {
    level: "silent",
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}

type AnySock = any;

/** Persisted parts of the session that must survive a server restart. */
interface PersistedState {
  monitored: string[];
}

class WhatsAppSession {
  sock: AnySock = null;
  creds: any = null;
  monitored = new Set<string>();
  messages = new Map<string, WaMessage>();
  messagesLoaded = false;
  groups = new Map<string, WaGroup>();
  phase: WaPhase = "idle";
  connection: string | null = null;
  qr: string | null = null;
  qrSeq = 0;
  me: string | null = null;
  closeReason: string | null = null;
  lastError: string | null = null;
  startedAt: string | null = null;
  reconnectAttempts = 0;
  private stopReconnect = false;
  private reconnecting = false;
  private pending: WaMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: WaState) => void>();
  private starting: Promise<void> | null = null;

  constructor() {
    void this.loadPersisted();
  }

  // ── observers ───────────────────────────────────────────────────────────

  subscribe(fn: (s: WaState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snapshot = this.state();
    for (const fn of this.listeners) {
      try {
        fn(snapshot);
      } catch {
        /* a bad listener must not break the socket */
      }
    }
  }

  state(): WaState {
    return {
      phase: this.phase,
      connection: this.connection,
      qr: this.qr,
      qrSeq: this.qrSeq,
      registered: this.isRegistered(),
      me: this.me,
      closeReason: this.closeReason,
      lastError: this.lastError,
      groups: this.groups.size,
      messages: this.messages.size,
      newMessages: this.messages.size,
      startedAt: this.startedAt,
    };
  }

  isRunning(): boolean {
    return this.sock !== null && this.connection !== "close";
  }

  /**
   * A paired session is one whose creds carry an identity. Read from disk
   * because a freshly booted server has not loaded the socket yet.
   */
  isRegistered(): boolean {
    if (this.creds?.me?.id) return true;
    try {
      const raw = require("node:fs").readFileSync(
        path.join(WA_AUTH_DIR, "creds.json"),
        "utf8",
      ) as string;
      return Boolean(JSON.parse(raw)?.me?.id);
    } catch {
      return false;
    }
  }

  // ── persistence ─────────────────────────────────────────────────────────

  private async loadPersisted() {
    try {
      const raw = await fs.readFile(WA_STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      for (const jid of parsed.monitored || []) this.monitored.add(jid);
    } catch {
      /* first run */
    }
    await this.loadMessages();
  }

  private async savePersisted() {
    const payload: PersistedState = { monitored: [...this.monitored] };
    try {
      await fs.mkdir(WA_SESSION_DIR, { recursive: true });
      await fs.writeFile(WA_STATE_FILE, JSON.stringify(payload, null, 2));
    } catch {
      /* non-fatal */
    }
  }

  private async loadMessages() {
    if (this.messagesLoaded) return;
    this.messages.clear();
    try {
      const raw = await fs.readFile(WA_MESSAGES_FILE, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line) as WaMessage;
          if (m?.id) this.messages.set(m.id, m);
        } catch {
          /* torn line */
        }
      }
    } catch {
      /* no store yet */
    }
    while (this.messages.size > MAX_MESSAGES) {
      const oldest = this.messages.keys().next().value;
      this.messages.delete(oldest);
      const oldest = this.messages.keys().next().value as string | undefined;
      if (oldest !== undefined) this.messages.delete(oldest);
    }
    this.messagesLoaded = true;
  }

  private flushMessages() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.pending.splice(0, this.pending.length);
    if (!batch.length) return;
    const lines = batch.map((m) => JSON.stringify(m)).join("\n") + "\n";
    fs.mkdir(WA_SESSION_DIR, { recursive: true })
      .then(() => fs.appendFile(WA_MESSAGES_FILE, lines))
      .catch(() => {
        /* non-fatal */
      });
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushMessages();
    }, FLUSH_DEBOUNCE_MS);
  }

  // ── monitored groups ────────────────────────────────────────────────────

  listGroups(): WaGroup[] {
    return [...this.groups.values()]
      .map((g) => ({ ...g, monitored: this.monitored.has(g.jid) }))
      .sort((a, b) => a.subject.localeCompare(b.subject, "he"));
  }

  async setMonitored(jids: string[], on: boolean) {
    const changed: string[] = [];
    for (const raw of jids) {
      const jid = normalizeJid(raw);
      if (!jid) continue;
      if (on) this.monitored.add(jid);
      else this.monitored.delete(jid);
      changed.push(jid);
    }
    for (const g of this.groups.values()) {
      g.monitored = this.monitored.has(g.jid);
    }
    await this.savePersisted();
    this.emit();
    return changed;
  }

  monitoredJids(): string[] {
    return [...this.monitored];
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart() {
    this.stopReconnect = false;
    if (this.sock && this.connection !== "close") return;

    try {
      const [{ makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason }, qrcode] =
      const [{ makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers }, qrcode] =
        await Promise.all([
          import("@whiskeysockets/baileys"),
          import("qrcode"),
        ]);

      this.lastError = null;
      this.closeReason = null;
      this.startedAt = new Date().toISOString();

      await fs.mkdir(WA_AUTH_DIR, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
      this.creds = state.creds;

      const { version } = await fetchLatestBaileysVersion().catch(() => ({
        version: [2, 3000, 1025153825] as [number, number, number],
      }));

      const sock = makeWASocket({
      const sock: AnySock = makeWASocket({
        version,
        auth: state,
        logger: quietLogger(),
        browser: Browsers.macOS("Desktop"),
        qrTimeout: 120000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
      });
      this.sock = sock;
      this.disconnectReasons = DisconnectReason;

      // v6 declares saveCreds as taking no argument, but at runtime it takes the
// merged update. Cast so the declaration does not strip the call.
const save = saveCreds as unknown as (u: unknown) => Promise<void>;

      sock.ev.on("creds.update", async (update: any) => {
        this.creds = { ...(this.creds || {}), ...(update || {}) };
        try {
          await saveCreds(update);
          await save(update);
        } catch {
          /* non-fatal */
        }
      });

      sock.ev.on("connection.update", async (u: any) => {
        if (u.connection !== undefined) this.connection = u.connection;
        if (u.qr) await this.setQr(u.qr, qrcode);
        if (u.lastDisconnect) this.closeReason = describeDisconnect(u.lastDisconnect);

        if (u.connection === "connecting") {
          this.phase = "connecting";
          this.qr = null;
        }
        if (u.connection === "open") {
          this.phase = "open";
          this.qr = null;
          this.closeReason = null;
          this.lastError = null;
          this.reconnectAttempts = 0;
          this.stopReconnect = false;
          if (this.creds?.me?.id) this.me = `${this.creds.me.id} (${this.creds.me.name || ""})`.trim();
          this.emit();
          // Prime the group list once, so the tab has something to show.
          void this.refreshGroups().catch(() => undefined);
        }
        if (u.connection === "close") {
          this.phase = "closed";
          this.emit();
          const code = u.lastDisconnect?.error?.output?.statusCode;
          // 401 = the session was unlinked on the phone. Retrying cannot help.
          if (code === 401) {
            this.stopReconnect = true;
            this.lastError = "הסשן בוטל מהמכשיר (401) - צריך לחבר מחדש";
            this.emit();
            return;
          }
          this.maybeReconnect();
        }
        this.emit();
      });

      sock.ev.on("messages.upsert", ({ messages }: any = {}) => {
        if (messages?.length) this.capture(messages);
      });
      sock.ev.on("messaging-history.set", (update: any) => {
        if (update?.messages?.length) this.capture(update.messages);
      });

      // v6 auto-starts the socket on creation; `connect` only exists in v7.
      if (typeof sock.connect === "function") {
        try {
          await sock.connect({});
        } catch (err: any) {
          this.lastError = String(err?.message || err);
          this.phase = "error";
        }
      } else {
        this.phase = "connecting";
      }
      this.emit();
    } catch (err: any) {
      this.lastError = String(err?.message || err);
      this.phase = "error";
      this.emit();
      throw err;
    }
  }

  private disconnectReasons: Record<string, number> = {};

  private async setQr(payload: string, qrcode: any) {
    this.qrSeq += 1;
    this.phase = "pairing";
    try {
      this.qr = await qrcode.toDataURL(payload, { width: 440, margin: 2 });
    } catch {
      this.qr = null;
    }
    this.emit();
  }

  private maybeReconnect() {
    if (this.stopReconnect || this.reconnecting) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.lastError = `נכשל להתחבר מחדש אחרי ${MAX_RECONNECT_ATTEMPTS} ניסיונות`;
      this.emit();
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    this.emit();
    setTimeout(async () => {
      this.reconnecting = false;
      this.sock = null;
      try {
        await this.start();
      } catch {
        /* state already reflects the failure */
      }
    }, RECONNECT_DELAY_MS);
  }

  async stop() {
    this.stopReconnect = true;
    this.flushMessages();
    const sock = this.sock;
    this.sock = null;
    this.connection = null;
    this.phase = "idle";
    this.qr = null;
    this.reconnectAttempts = 0;
    this.emit();
    if (sock) {
      try {
        await sock.end(undefined);
      } catch {
        /* ignore */
      }
    }
  }

  /** Stop and start again - the fix when a socket is wedged. */
  async restart() {
    await this.stop();
    await this.start();
  }

  // ── groups ──────────────────────────────────────────────────────────────

  async refreshGroups(): Promise<WaGroup[]> {
    if (!this.sock) return this.listGroups();
    let raw: Record<string, any>;
    try {
      raw = await this.sock.groupFetchAllParticipating();
    } catch {
      return this.listGroups();
    }
    this.groups.clear();
    for (const g of Object.values(raw || {})) {
      this.groups.set(g.id, {
        jid: g.id,
        subject: g.subject || "(ללא שם)",
        size: g.size || g.participants?.length || 0,
        monitored: this.monitored.has(g.id),
      });
    }
    this.emit();
    return this.listGroups();
  }

  async joinByInvite(code: string) {
    if (!this.sock) throw new Error("הסשן לא מחובר");
    const clean = String(code || "")
      .trim()
      .replace(/^https?:\/\/chat\.whatsapp\.com\//i, "")
      .replace(/[^A-Za-z0-9_-]/g, "");
    if (!clean) throw new Error("קוד הזמנה לא תקין");
    await this.sock.groupAcceptInvite(clean);
    await this.refreshGroups();
    return clean;
  }

  async leaveGroup(jid: string) {
    if (!this.sock) throw new Error("הסשן לא מחובר");
    await this.sock.groupLeave(normalizeJid(jid));
    this.monitored.delete(jid);
    await this.savePersisted();
    await this.refreshGroups();
  }

  // ── messages ────────────────────────────────────────────────────────────

  /** Flatten a Baileys message and keep it if its group is monitored. */
  private capture(list: any[]) {
    let added = 0;
    for (const raw of list) {
      if (!raw?.key?.id) continue;
      const jid: string | null = raw.key.remoteJid || null;
      if (jid && this.monitored.size > 0 && !this.monitored.has(jid)) continue;
      // Only monitored groups are written to disk. This is a personal account
      // with hundreds of groups on it; capturing all of them by default would
      // store other people's conversations without anyone asking for it.
      if (jid && !this.monitored.has(jid)) continue;

      const msg = raw.message || {};
      const ctx =
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo ||
        msg.documentMessage?.contextInfo ||
        null;

      let text: string =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        msg.buttonsMessage?.contentText ||
        msg.templateMessage?.hydratedTemplate?.hydratedContentText ||
        "";
      if (Array.isArray(text)) {
        text = text.map((p: any) => p?.text || "").join(" ");
      }
      text = String(text || "").trim();

      let kind = "text";
      if (msg.imageMessage) kind = "image";
      else if (msg.videoMessage) kind = "video";
      else if (msg.documentMessage) kind = "document";
      else if (msg.audioMessage) kind = "audio";
      else if (msg.stickerMessage) kind = "sticker";
      else if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3) kind = "poll";
      else if (msg.contactMessage || msg.contactsArrayMessage) kind = "contact";
      else if (msg.locationMessage || msg.liveLocationMessage) kind = "location";
      else if (!text) kind = "system";

      const quoted = ctx?.quotedMessage
        ? ctx.quotedMessage.conversation ||
          ctx.quotedMessage.extendedTextMessage?.text ||
          ctx.quotedMessage.imageMessage?.caption ||
          ""
        : null;

      const id = raw.key.id;
      if (this.messages.has(id)) continue;

      const record: WaMessage = {
        id,
        jid,
        fromMe: Boolean(raw.key.fromMe),
        author: raw.key.participant || raw.key.remoteJid || null,
        pushName: raw.pushName || null,
        ts: toMillis(raw.messageTimestamp),
        kind,
        text,
        quoted: quoted ? String(quoted).slice(0, 400) : null,
        groupSubject: jid ? this.groups.get(jid)?.subject || null : null,
      };

      this.messages.set(id, record);
      this.pending.push(record);
      added += 1;
      while (this.messages.size > MAX_MESSAGES) {
        const oldest = this.messages.keys().next().value;
        this.messages.delete(oldest);
        const oldest = this.messages.keys().next().value as string | undefined;
        if (oldest !== undefined) this.messages.delete(oldest);
      }
    }
    if (added) {
      this.scheduleFlush();
      this.emit();
    }
  }

  async listMessages(opts: {
    jid?: string;
    limit?: number;
    q?: string;
    since?: number;
    kind?: string;
  }): Promise<{ total: number; messages: WaMessage[]; store: { total: number } }> {
    await this.loadMessages();
    const needle = opts.q ? opts.q.toLowerCase() : null;
    const out: WaMessage[] = [];
    for (const m of this.messages.values()) {
      if (opts.jid && m.jid !== opts.jid) continue;
      if (opts.since && m.ts < opts.since) continue;
      if (opts.kind && m.kind !== opts.kind) continue;
      if (needle && !(m.text || "").toLowerCase().includes(needle)) continue;
      out.push(m);
    }
    out.sort((a, b) => a.ts - b.ts);
    const limit = Math.max(1, Math.min(opts.limit || 100, 500));
    return {
      total: out.length,
      messages: out.slice(-limit),
      store: { total: this.messages.size },
    };
  }

  /** Ask the phone to push a chat's recent history, then wait for it to land. */
  /**
   * Ask the phone to push a chat's recent history, then wait for it to land.
   *
   * Baileys' fetchMessageHistory only sends a historySyncOnDemandRequest; the
   * phone answers asynchronously via messages.upsert. So a zero result does not
   * mean "no history" - it means the phone did not push, because it is offline
   * or because WhatsApp will not serve on-demand group history to a secondary
   * device. Live capture is the dependable path.
   */
  async fetchHistory(jid: string, count = 50, quietMs = 2500) {
    if (!this.sock) throw new Error("הסשן לא מחובר");
    if (typeof this.sock.fetchMessageHistory !== "function") {
      throw new Error("גרסת Baileys אינה תומכת במשיכת היסטוריה");
    }
    const target = normalizeJid(jid);
    if (!target) throw new Error("JID לא תקין");
    const before = await this.countFor(target);
    const req = Math.max(1, Math.min(count, 100));
    await this.sock.fetchMessageHistory(req, {
      remoteJid: target,
      fromMe: false,
      id: target.slice(0, 8),
    });
    const deadline = Date.now() + 20000;
    let seen = before;
    let lastAt = Date.now();
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const now = await this.countFor(target);
      if (now !== seen) {
        seen = now;
        lastAt = Date.now();
      } else if (now > before && Date.now() - lastAt >= quietMs) break;
    }
    this.flushMessages();
    return {
      jid: target,
      requested: req,
      newMessages: seen - before,
      total: seen,
      // Surface the "phone did not push" case instead of leaving the UI to
      // report a bare zero and read like "this group is empty".
      note:
        seen > before
          ? null
          : "הטלפון לא החזיר היסטוריה. היסטוריה נמשכת רק כשהטלפון מחובר ופעיל; הודעות חדשות נלכדות תמיד.",
    };
  }

  private async countFor(jid: string) {
    await this.loadMessages();
    let n = 0;
    for (const m of this.messages.values()) if (m.jid === jid) n++;
    return n;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

export function normalizeJid(input: string): string | null {
  const s = String(input || "").trim();
  if (!s) return null;
  if (s.includes("@g.us")) return s;
  if (s.includes("@")) return null;
  const digits = s.replace(/\D/g, "");
  return digits ? `${digits}@g.us` : null;
}

function toMillis(ts: any): number {
  const n =
    typeof ts === "bigint"
      ? Number(ts)
      : typeof ts === "object" && ts && typeof ts.toNumber === "function"
        ? ts.toNumber()
        : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n > 1e12 ? n : n * 1000;
}

function describeDisconnect(last: any): string {
  const code = last?.error?.output?.statusCode;
  const msg = last?.error?.message || "";
  const map: Record<number, string> = {
    401: "הסשן בוטל מהמכשיר",
    408: "פסק זמן",
    411: "החיבור נותק",
    428: "צריך לסרוק QR מחדש",
    440: "החיבור הוחלף בחיבור אחר",
    500: "שגיאת שרת WhatsApp",
    515: "צריך לסרוק QR מחדש",
  };
  return map[code] || msg || "החיבור נסגר";
}

/**
 * One session per server process. HMR re-evaluates this module on every edit,
 * so the instance hangs off globalThis - otherwise each save would open another
 * socket and WhatsApp would keep kicking the oldest one off.
 */
const GLOBAL_KEY = "__cwWhatsAppSession";
type GlobalWithSession = typeof globalThis & { [GLOBAL_KEY]?: WhatsAppSession };

export function getSession(): WhatsAppSession {
  const g = globalThis as GlobalWithSession;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new WhatsAppSession();
  return g[GLOBAL_KEY];
}