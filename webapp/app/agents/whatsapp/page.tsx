"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function WhatsAppScannerPage() {
  const [serverStatus, setServerStatus] = useState<"checking" | "running" | "stopped" | "error">("checking");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [monitoredGroups, setMonitoredGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  const WA_SCANNER_URL = "http://localhost:8789";

  const checkServer = async () => {
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/status`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setServerStatus("running");
        setPaired(data.paired);
        if (data.paired) {
          await loadGroups();
          connectSSE();
        }
      } else {
        setServerStatus("stopped");
      }
    } catch {
      setServerStatus("stopped");
    }
  };

  const connectSSE = () => {
    if (eventSource) eventSource.close();
    const es = new EventSource(`${WA_SCANNER_URL}/api/events`, { withCredentials: true });
    setEventSource(es);

    es.addEventListener("state", (e) => {
      const data = JSON.parse(e.data);
      if (data.qrSeq) {
        // QR will come via 'qr' event
      }
    });

    es.addEventListener("qr", (e) => {
      const data = JSON.parse(e.data);
      setQrCode(data.dataUrl);
    });

    es.addEventListener("connection", (e) => {
      const data = JSON.parse(e.data);
      if (data.connection === "open") {
        setPaired(true);
        setQrCode(null);
        loadGroups();
      } else if (data.connection === "close") {
        setPaired(false);
      }
    });

    es.addEventListener("groups", () => {
      loadGroups();
    });

    es.onerror = () => {
      console.log("SSE connection lost, reconnecting...");
      setTimeout(connectSSE, 3000);
    };
  };

  const loadGroups = async () => {
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/groups`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch (e) {
      console.error("Failed to load groups:", e);
    }
  };

  const startSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (res.ok) {
        checkServer();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to start session");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const stopSession = async () => {
    setLoading(true);
    try {
      await fetch(`${WA_SCANNER_URL}/api/session/stop`, {
        method: "POST",
        credentials: "include",
      });
      setPaired(false);
      setQrCode(null);
      setGroups([]);
    } catch (e) {
      console.error("Failed to stop session:", e);
    } finally {
      setLoading(false);
    }
  };

  const monitorGroup = async (jid: string, add: boolean) => {
    try {
      await fetch(`${WA_SCANNER_URL}/api/groups/${add ? "monitor" : "unmonitor"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jids: [jid] }),
      });
      loadGroups();
    } catch (e) {
      console.error("Failed to monitor group:", e);
    }
  };

  const joinInvite = async (code: string) => {
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/groups/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        loadGroups();
      }
    } catch (e) {
      console.error("Failed to join:", e);
    }
  };

  const loadMessages = async (jid: string) => {
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/messages?jid=${encodeURIComponent(jid)}&limit=100`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
  };

  const extractJobs = async (jid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/scan/extract-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jid, limit: 100 }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`נמצאו ${data.jobs.length} משרות מתוך ${data.scanned} הודעות`);
      }
    } catch (e) {
      console.error("Failed to extract jobs:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (jid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${WA_SCANNER_URL}/api/groups/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jid, count: 50 }),
      });
      if (res.ok) {
        loadMessages(jid);
      }
    } catch (e) {
      console.error("Failed to fetch history:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkServer();
    return () => { if (eventSource) eventSource.close(); };
  }, []);

  const formatTime = (ts: number) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("he-IL", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <Link href="/agents" className="back-link">← חזרה לסוכנים</Link>
        <div>
          <h2 className="page-title">📱 WhatsApp Job Scanner</h2>
          <p className="page-sub">סרוק קבוצות WhatsApp למשרות DevOps באמצעות Baileys</p>
        </div>
      </div>

      {/* Server Status Card */}
      <div className="source-card">
        <div className="source-header">
          <div className="source-info">
            <h3 className="source-name">מצב השרת</h3>
            <div className="source-meta">
              <span className={`badge ${serverStatus === "running" ? "badge-green" : serverStatus === "checking" ? "badge-blue" : "badge-gray"}`}>
                {serverStatus === "running" ? "פועל" : serverStatus === "checking" ? "בודק..." : "לא פועל"}
              </span>
            </div>
          </div>
        </div>
        <div className="source-actions">
          {serverStatus === "stopped" && (
            <button className="btn btn-primary" onClick={startSession} disabled={loading}>
              {loading ? <> <span className="spinner"></span> מפעיל... </> : "הפעל שרת WhatsApp Scanner"}
            </button>
          )}
          {serverStatus === "running" && !paired && (
            <button className="btn btn-primary" onClick={startSession} disabled={loading}>
              {loading ? <> <span className="spinner"></span> מתחבר... </> : "התחל התחברות"}
            </button>
          )}
          {paired && (
            <>
              <button className="btn btn-secondary" onClick={loadGroups} disabled={loading}>
                רענן קבוצות
              </button>
              <button className="btn btn-danger" onClick={stopSession} disabled={loading}>
                נתק
              </button>
            </>
          )}
        </div>
        {error && <div className="status-error">{error}</div>}
      </div>

      {/* QR Code */}
      {qrCode && (
        <div className="source-card" style={{ borderLeft: "4px solid #25d366" }}>
          <div className="source-header">
            <div className="source-info">
              <h3 className="source-name">סרוק QR Code</h3>
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "20px" }}>
            <img src={qrCode} alt="WhatsApp QR Code" style={{ maxWidth: "100%", height: "auto", borderRadius: "8px", boxShadow: "var(--shadow)" }} />
            <p style={{ marginTop: "12px", color: "var(--muted)" }}>פתח WhatsApp → הגדרות → מכשירים מקושרים → קשר מכשיר</p>
          </div>
        </div>
      )}

      {/* Paired - Show Groups */}
      {paired && (
        <>
          <div className="source-card">
            <div className="source-header">
              <div className="source-info">
                <h3 className="source-name">קבוצות ({groups.length})</h3>
              </div>
            </div>
            <div className="row" style={{ marginBottom: "16px" }}>
              <div style={{ flex: "2" }}>
                <input
                  type="text"
                  id="inviteCode"
                  className="input"
                  placeholder="קוד הזמנה (החלק אחרי chat.whatsapp.com/)"
                  onKeyDown={(e) => e.key === "Enter" && joinInvite((e.target as HTMLInputElement).value)}
                />
              </div>
              <button className="btn btn-info" onClick={() => joinInvite((document.getElementById("inviteCode") as HTMLInputElement).value)}>
                הצטרף
              </button>
            </div>
            <div className="group-list" style={{ maxHeight: "400px", overflowY: "auto" }}>
              {groups.map((g) => (
                <div key={g.jid} className="group-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderBottom: "1px solid var(--border)" }}>
                  <div className="group-info" style={{ flex: "1", minWidth: "0" }}>
                    <div className="group-name" style={{ fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.subject}</div>
                    <div className="group-meta" style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "2px" }}>{g.jid} · {g.size} חברים {monitoredGroups.includes(g.jid) && "✓ מנוטרת"}</div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {!monitoredGroups.includes(g.jid) && (
                      <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => monitorGroup(g.jid, true)}>
                        נטר
                      </button>
                    )}
                    {monitoredGroups.includes(g.jid) && (
                      <>
                        <button className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => loadMessages(g.jid)}>
                          הודעות
                        </button>
                        <button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => extractJobs(g.jid)}>
                          חלץ משרות
                        </button>
                        <button className="btn btn-info" style={{ padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => fetchHistory(g.jid)}>
                          היסטוריה
                        </button>
                        <button className="btn btn-danger" style={{ padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => monitorGroup(g.jid, false)}>
                          הפסק
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Messages */}
          {messages.length > 0 && (
            <div className="source-card">
              <div className="source-header">
                <div className="source-info">
                  <h3 className="source-name">הודעות ({messages.length})</h3>
                </div>
              </div>
              <div className="msg-list" style={{ maxHeight: "500px", overflowY: "auto" }}>
                {messages.slice().reverse().map((m) => (
                  <div key={m.id} className="msg-item" style={{ borderBottom: "1px solid var(--border)", padding: "12px" }}>
                    <div style={{ display: "flex", gap: "12px", marginBottom: "8px", flexWrap: "wrap" }}>
                      <strong>{m.jid || "—"}</strong>
                      <span>{formatTime(m.ts)}</span>
                      {m.pushName && <span>{m.pushName}</span>}
                      {m.fromMe && <span style={{ color: "var(--primary)" }}>📤 שלי</span>}
                      <span style={{ background: "rgba(59,130,246,0.15)", color: "var(--info)", padding: "2px 8px", borderRadius: "999px", fontSize: "0.75rem" }}>{m.kind}</span>
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: "0.875rem", lineHeight: "1.6" }}>{m.text || "(ללא טקסט)"}</div>
                    {m.quoted && (
                      <div style={{ color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: "8px", marginTop: "8px", fontSize: "0.75rem" }}>
                        ↳ מצוטט: {m.quoted}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Server not running - instructions */}
      {serverStatus === "stopped" && (
        <div className="source-card">
          <div className="source-header">
            <div className="source-info">
              <h3 className="source-name">הפעלה ידנית</h3>
            </div>
          </div>
          <div style={{ padding: "16px", background: "var(--bg)", borderRadius: "8px", fontFamily: "monospace", fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>
{`# בטרמינל נפרד:
cd agents/wa_scanner
npm start

# או עם טוקן אבטחה:
WA_TOKEN=your-secret-token npm start

# השרת יעלה על http://localhost:8789
# לחץ על "הפעל שרת WhatsApp Scanner" למעלה אחרי שהשרת רץ`}
          </div>
        </div>
      )}
    </div>
  );
}