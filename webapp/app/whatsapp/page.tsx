"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/**
 * WhatsApp job scanner.
 *
 * The Baileys socket lives in the Next server (lib/whatsapp/session.ts), so this
 * tab is a thin client: status arrives over SSE, and everything else is a plain
 * fetch. A pairing QR is only ever emitted once per socket, which is why the
 * cached data URL is kept in state and re-rendered after a reload.
 */

interface WaStatus {
  ok: boolean;
  phase: "idle" | "connecting" | "pairing" | "open" | "closed" | "error";
  connection: string | null;
  qr: string | null;
  qrSeq: number;
  registered: boolean;
  me: string | null;
  closeReason: string | null;
  lastError: string | null;
  groups: number;
  messages: number;
  startedAt: string | null;
  monitored: string[];
}

interface WaGroup {
  jid: string;
  subject: string;
  size: number;
  monitored: boolean;
}

interface WaMessage {
  id: string;
  jid: string | null;
  fromMe: boolean;
  pushName: string | null;
  ts: number;
  kind: string;
  text: string;
  quoted?: string | null;
  groupSubject?: string | null;
}

interface ScanResult {
  ok: boolean;
  error?: string;
  scanned: number;
  matched: number;
  saved: { inserted: number; skipped: number; mode: string; error?: string | null };
  groups: string[];
  jobs: Array<{ title: string; company: string | null; score: number; keywords: string[] }>;
}

const PHASE_LABEL: Record<string, string> = {
  idle: "ממתין",
  connecting: "מתחבר...",
  pairing: "מצמד - סרקו QR",
  open: "מחובר",
  closed: "מנותק",
  error: "שגיאה",
};

const PHASE_BADGE: Record<string, string> = {
  idle: "badge-gray",
  connecting: "badge-blue",
  pairing: "badge-purple",
  open: "badge-green",
  closed: "badge-gray",
  error: "badge-red",
};

export default function WhatsAppPage() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [groups, setGroups] = useState<WaGroup[]>([]);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [connected, setConnected] = useState(false);

  const say = useCallback((kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice((n) => (n && n.text === text ? null : n)), 6000);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
      if (!res.ok) return;
      const data: WaStatus = await res.json();
      setStatus(data);
      // A QR already on the server (socket connected before this page loaded)
      // still has to be shown, or the tab looks stuck in "pairing".
      if (data.qr) setQr(data.qr);
    } catch {
      /* the tab keeps whatever it last knew */
    }
  }, []);

  const loadGroups = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/whatsapp/groups${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.groups) setGroups(data.groups);
    } catch {
      /* ignore */
    }
  }, []);

  const loadMessages = useCallback(async (jid?: string | null) => {
    try {
      const params = new URLSearchParams({ limit: "80" });
      if (jid) params.set("jid", jid);
      const res = await fetch(`/api/whatsapp/messages?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      /* ignore */
    }
  }, []);

  // ── SSE: state, pairing QR, new messages ─────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/whatsapp/events");
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("state", (e) => {
      const s = JSON.parse(e.data) as WaStatus;
      setStatus((prev) => ({ ...(prev as WaStatus), ...s }));
      if (s.phase === "open" || s.phase === "closed") setQr(null);
    });
    es.addEventListener("qr", (e) => setQr(JSON.parse(e.data).dataUrl));
    es.addEventListener("groups", (e) => {
      const g = JSON.parse(e.data).groups;
      if (Array.isArray(g)) setGroups(g);
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    loadStatus();
    loadGroups();
    loadMessages();
  }, [loadStatus, loadGroups, loadMessages]);

  // Reload groups + messages once the socket actually opens.
  const phase = status?.phase;
  useEffect(() => {
    if (phase === "open") {
      loadGroups(true);
      loadMessages(activeJid);
    }
  }, [phase, activeJid, loadGroups, loadMessages]);

  // ── actions ──────────────────────────────────────────────────────────────
  const sessionAction = async (action: "start" | "stop" | "restart") => {
    setBusy(action);
    try {
      const res = await fetch("/api/whatsapp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) say("err", data.error || "הפעולה נכשלה");
      else if (action === "start") say("ok", "מתחבר ל-WhatsApp...");
      else if (action === "stop") {
        setQr(null);
        say("ok", "החיבור נסגר");
      } else say("ok", "החיבור אופס");
      await loadStatus();
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleGroup = async (jid: string, on: boolean) => {
    setGroups((prev) =>
      prev.map((g) => (g.jid === jid ? { ...g, monitored: on } : g)),
    );
    try {
      const res = await fetch("/api/whatsapp/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "monitor" : "unmonitor", jids: [jid] }),
      });
      const data = await res.json();
      if (!res.ok) say("err", data.error || "עדכון הקבוצה נכשל");
      if (data.groups) setGroups(data.groups);
    } catch (err) {
      say("err", String(err));
    }
  };

  const monitorAll = async (on: boolean) => {
    setBusy(on ? "monitor-all" : "unmonitor-all");
    try {
      const res = await fetch("/api/whatsapp/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "monitor" : "unmonitor", jids: groups.map((g) => g.jid) }),
      });
      const data = await res.json();
      if (!res.ok) say("err", data.error || "הפעולה נכשלה");
      else say("ok", on ? `סומנו ${groups.length} קבוצות לניטור` : "הניטור הוסר");
      if (data.groups) setGroups(data.groups);
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(null);
    }
  };

  const joinInvite = async () => {
    if (!invite.trim()) return;
    setBusy("join");
    try {
      const res = await fetch("/api/whatsapp/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: invite }),
      });
      const data = await res.json();
      if (!res.ok) say("err", data.error || "ההצטרפות נכשלה");
      else {
        say("ok", "הצטרפת לקבוצה");
        setInvite("");
        if (data.groups) setGroups(data.groups);
      }
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(null);
    }
  };

  const fetchHistory = async (jid: string) => {
    setBusy(`history:${jid}`);
    try {
      const res = await fetch("/api/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "history", jid, count: 50 }),
      });
      const data = await res.json();
      if (!res.ok) say("err", data.error || "משיכת היסטוריה נכשלה");
      else if (data.note) say("err", data.note);
      else say("ok", `נמשכו ${data.newMessages} הודעות`);
      await loadMessages(jid);
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(null);
    }
  };

  const runScan = async (opts: { history?: number } = {}) => {
    setBusy("scan");
    try {
      const res = await fetch("/api/whatsapp/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jids: activeJid ? [activeJid] : undefined,
          limit: 300,
          history: opts.history || 0,
          save: true,
        }),
      });
      const data: ScanResult = await res.json();
      if (!res.ok) say("err", data.error || "הסריקה נכשלה");
      else {
        setScanResult(data);
        // A local-mode save "succeeds" but writes nothing; say so rather than
        // showing "נשמרו 3" for three rows that do not exist.
        say(
          data.saved.error ? "err" : "ok",
          data.saved.error
            ? `נמצאו ${data.matched} משרות · ${data.saved.error}`
            : `נסרקו ${data.scanned} הודעות · נמצאו ${data.matched} משרות · נשמרו ${data.saved.inserted}`,
        );
      }
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(null);
    }
  };

  // ── derived ──────────────────────────────────────────────────────────────
  const monitored = useMemo(() => groups.filter((g) => g.monitored), [groups]);
  const filtered = useMemo(() => groups.filter((g) => g.subject.includes(filter.trim())), [groups, filter]);
  const isOpen = status?.phase === "open";

  const visibleMessages = useMemo(() => {
    const list = activeJid ? messages.filter((m) => m.jid === activeJid) : messages;
    return list.slice().reverse();
  }, [messages, activeJid]);

  const JOB_HINT =
    /(devops|sre|platform|infrastructure|kubernetes|k8s|terraform|docker|ansible|jenkins|ci\/cd|aws|gcp|azure|linux|תשתיות|ענן|דוופס|קונטיינרים|מחפשים|דרוש|משרה)/i;

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">WhatsApp</h2>
        <p className="page-sub">
          חיבור חשבון WhatsApp אישי, ניטור קבוצות משרות וחילוץ משרות DevOps אל{" "}
          <Link href="/agents">סוכני המשרות</Link>.
        </p>
      </div>

      {notice && (
        <div className={notice.kind === "err" ? "status-error" : "wa-notice"} style={{ marginBottom: 14 }}>
          {notice.text}
        </div>
      )}

      {/* ── status + pairing ─────────────────────────────────────────── */}
      <div className="wa-card" style={{ marginBottom: 16 }}>
        <div className="source-header">
          <div className="source-info">
            <h3>מצב החיבור</h3>
            <div className="source-meta">
              <span className={`badge ${PHASE_BADGE[status?.phase || "idle"]}`}>
                {PHASE_LABEL[status?.phase || "idle"]}
              </span>
              {status?.me && <span className="source-uid">{status.me}</span>}
              {!connected && <span className="source-domain">ערוץ האירועים מנותק</span>}
            </div>
          </div>
          <div className="wa-toolbar">
            <button
              className="btn btn-primary"
              onClick={() => sessionAction("start")}
              disabled={!!busy || status?.phase === "open"}
            >
              {busy === "start" ? <><span className="spinner" />מתחבר...</> : "התחל חיבור"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => sessionAction("restart")}
              disabled={!!busy || status?.phase === "idle"}
            >
              {busy === "restart" ? <><span className="spinner" />מאפס...</> : "אפס חיבור"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => sessionAction("stop")}
              disabled={!!busy || status?.phase === "idle"}
            >
              נתק
            </button>
          </div>
        </div>

        {status?.lastError && <div className="status-error">{status.lastError}</div>}
        {status?.closeReason && !status?.lastError && (
          <div className="wa-notice">החיבור נסגר: {status.closeReason}</div>
        )}

        {qr && (
          <div className="wa-qr">
            <img src={qr} alt="QR code לחיבור WhatsApp" />
            <div className="hint">
              ב-WhatsApp: <strong>הגדרות → מכשירים מקושרים → קשר מכשיר</strong>
              <br />
              סרקו את הקוד. ה-QR מתחלף מדי כמה שניות - סרקו את האחרון.
            </div>
          </div>
        )}

        {!status?.registered && !qr && (
          <div className="wa-notice">
            אין סשן שמור ב-<code>.wa-session</code>. לחצו "התחל חיבור" וסרקו את ה-QR.
          </div>
        )}
      </div>

      <div className="wa-layout">
        {/* ── groups ─────────────────────────────────────────────────── */}
        <div className="wa-card">
          <h3>קבוצות ({monitored.length} מנוטרות מתוך {groups.length})</h3>

          <div className="wa-toolbar">
            <input
              className="input"
              placeholder="סינון קבוצות..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="btn btn-secondary"
              onClick={() => loadGroups(true)}
              disabled={!isOpen || !!busy}
            >
              רענן
            </button>
          </div>

          <div className="wa-toolbar">
            <button
              className="btn btn-secondary"
              onClick={() => monitorAll(true)}
              disabled={!isOpen || !groups.length || !!busy}
            >
              {busy === "monitor-all" ? <><span className="spinner" />...</> : "נטר הכול"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => monitorAll(false)}
              disabled={!monitored.length || !!busy}
            >
              {busy === "unmonitor-all" ? <><span className="spinner" />...</> : "הפסק הכול"}
            </button>
          </div>

          <div className="wa-toolbar">
            <input
              className="input"
              placeholder="קוד הזמנה chat.whatsapp.com/..."
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && joinInvite()}
            />
            <button
              className="btn btn-primary"
              onClick={joinInvite}
              disabled={!isOpen || !invite.trim() || !!busy}
            >
              {busy === "join" ? <><span className="spinner" />...</> : "הצטרף"}
            </button>
          </div>

          <div className="wa-groups">
            {filtered.length === 0 && (
              <div className="empty-state" style={{ padding: 28 }}>
                {isOpen ? "לא נמצאו קבוצות. לחצו רענן." : "חברו קודם חשבון WhatsApp."}
              </div>
            )}
            {filtered.map((g) => (
              <div key={g.jid} className={`wa-group ${g.monitored ? "on" : ""}`}>
                <button
                  className="source-info"
                  style={{ background: "none", border: "none", textAlign: "right", cursor: "pointer", padding: 0 }}
                  onClick={() => setActiveJid(activeJid === g.jid ? null : g.jid)}
                  title={g.jid}
                >
                  <div className="name">{g.subject}</div>
                  <div className="meta">
                    {g.size} חברים{g.monitored ? " · מנוטרת" : ""}
                  </div>
                </button>
                <div className="wa-toolbar" style={{ flexWrap: "nowrap" }}>
                  {g.monitored && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "5px 10px", fontSize: 12 }}
                      onClick={() => fetchHistory(g.jid)}
                      disabled={!!busy}
                    >
                      {busy === `history:${g.jid}` ? <><span className="spinner" />...</> : "היסטוריה"}
                    </button>
                  )}
                  <button
                    className={g.monitored ? "btn btn-secondary" : "btn btn-primary"}
                    style={{ padding: "5px 10px", fontSize: 12 }}
                    onClick={() => toggleGroup(g.jid, !g.monitored)}
                    disabled={!isOpen}
                  >
                    {g.monitored ? "הפסק" : "נטר"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── messages + scan ────────────────────────────────────────── */}
        <div className="wa-card">
          <h3>
            הודעות {activeJid ? "בקבוצה שנבחרה" : `מכל הקבוצות (${messages.length})`}
          </h3>

          <div className="wa-toolbar">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setActiveJid(null);
                loadMessages(null);
              }}
              disabled={!activeJid}
            >
              כל הקבוצות
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => loadMessages(activeJid)}
              disabled={!!busy}
            >
              רענן
            </button>
            <button
              className="btn btn-primary"
              onClick={() => runScan({})}
              disabled={!isOpen || !monitored.length || !!busy}
            >
              {busy === "scan" ? <><span className="spinner" />סורק...</> : "חלץ משרות"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => runScan({ history: 50 })}
              disabled={!isOpen || !monitored.length || !!busy}
            >
              משוך היסטוריה וסרוק
            </button>
          </div>

          {scanResult && (
            <div className="wa-notice">
              נסרקו {scanResult.scanned} הודעות · נמצאו {scanResult.matched} משרות · נשמרו{" "}
              {scanResult.saved.inserted} ({scanResult.saved.mode})
              {scanResult.saved.error && (
                <>
                  <br />
                  <strong>{scanResult.saved.error}</strong>
                </>
              )}
              {scanResult.matched > 0 && (
                <>
                  {" "}
                  <Link href="/whatsapp/jobs">לכל המשרות</Link>
                </>
              )}
            </div>
          )}

          <div className="wa-msgs">
            {visibleMessages.length === 0 && (
              <div className="empty-state" style={{ padding: 28 }}>
                {isOpen
                  ? "אין עדיין הודעות. סמנו קבוצה לניטור, או לחצו \"משוך היסטוריה וסרוק\"."
                  : "התחברו ל-WhatsApp כדי לראות הודעות."}
              </div>
            )}
            {visibleMessages.map((m) => (
              <div key={m.id} className={`wa-msg ${JOB_HINT.test(m.text || "") ? "job" : ""}`}>
                <div className="head">
                  <strong>{m.groupSubject || m.jid || "צ׳אט"}</strong>
                  <span>{m.pushName || "—"}</span>
                  <span>{new Date(m.ts).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="badge badge-gray">{m.kind}</span>
                  {m.fromMe && <span className="badge badge-blue">שלי</span>}
                </div>
                <div className="body">{m.text || "(ללא טקסט)"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}