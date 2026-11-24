"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LuPlus, LuX, LuPlay, LuSparkles } from "react-icons/lu";

interface Source {
  id: string;
  name: string;
  type: "board" | "comeet" | "ats" | "portal" | "company";
  domain?: string;
  uid?: string;
  slug?: string;
  discoverFrom?: string;
  foundOn?: string;
  enabled: boolean;
  lastScannedAt?: string | null;
  nextScanAt?: string | null;
}

interface ScanStatus {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  result?: any;
  error?: string;
}

interface SourcesResponse {
  sources: Source[];
  summary: { total: number; boards: number; comeet: number; ats: number; portals?: number; companies?: number };
}

interface DiscoveryState {
  status: "idle" | "running" | "completed" | "failed";
  result?: { probed?: number; remaining?: number; added?: { id: string; name: string }[] };
  error?: string;
}

interface RunAllState {
  status: "idle" | "running" | "completed";
  total: number;
  done: number;
  failed: number;
  running: string[];
  discover: boolean;
  discovery?: DiscoveryState;
}

export default function AgentsPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [summary, setSummary] = useState<SourcesResponse["summary"] | null>(null);
  const [scanStatuses, setScanStatuses] = useState<Record<string, ScanStatus>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [company, setCompany] = useState({ type: "ats" as "ats" | "comeet" | "portal", name: "", slug: "", uid: "", token: "", domain: "", discoverFrom: "", url: "" });
  const [runAll, setRunAll] = useState<RunAllState | null>(null);
  const [autoDiscover, setAutoDiscover] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const fetchRunAll = async () => {
    try {
      const res = await fetch("/api/agents/run-all");
      if (res.ok) setRunAll(await res.json());
    } catch (err) {
      console.error("Failed to fetch run-all state:", err);
    }
  };

  const startRunAll = async () => {
    const res = await fetch("/api/agents/run-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discover: autoDiscover, pages: 2 }),
    });
    if (res.ok) setRunAll(await res.json());
  };

  const startDiscovery = async () => {
    const res = await fetch("/api/agents/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 30 }),
    });
    if (res.ok) {
      const discovery = await res.json();
      setRunAll((previous) => ({ ...(previous ?? { status: "idle", total: 0, done: 0, failed: 0, running: [], discover: false }), discovery }));
    }
  };

  const runAllActive = runAll?.status === "running";
  const discoveryActive = runAll?.discovery?.status === "running";

  useEffect(() => {
    if (!runAllActive && !discoveryActive) return;
    const timer = window.setInterval(() => {
      fetchRunAll();
      fetchStatuses();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runAllActive, discoveryActive]);

  // Refresh the source list once discovery finishes so newly added agents appear.
  const discoveryStatus = runAll?.discovery?.status;
  useEffect(() => {
    if (discoveryStatus === "completed") fetchSources();
  }, [discoveryStatus]);

  const runAllStatus = runAll?.status;
  useEffect(() => {
    if (runAllStatus === "completed") fetchSources();
  }, [runAllStatus]);

  useEffect(() => {
    if (addOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [addOpen]);

  useEffect(() => {
    if (!scanning && !Object.values(scanStatuses).some((status) => status.status === "running")) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [scanning, scanStatuses]);

  const fetchSources = async () => {
    try {
      const res = await fetch("/api/agents/sources");
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources);
        setSummary(data.summary);
      }
    } catch (err) {
      console.error("Failed to fetch sources:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatuses = async () => {
    try {
      const res = await fetch("/api/agents/scan");
      if (res.ok) {
        const data = await res.json();
        setScanStatuses(data);
      }
    } catch (err) {
      console.error("Failed to fetch scan statuses:", err);
    }
  };

  const handleRescan = async (sourceId: string) => {
    setScanning(sourceId);
    setScanStartedAt(Date.now());
    try {
      const res = await fetch("/api/agents/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, options: { pages: 2 } }),
      });
      if (res.ok) {
        const result = await res.json();
        setScanStatuses((previous) => ({ ...previous, [sourceId]: { status: "running", startedAt: result.startedAt || new Date().toISOString() } }));
        // Poll for status
        pollStatus(sourceId);
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
    } finally {
      setScanning(null);
    }
  };

  const pollStatus = async (sourceId: string) => {
    for (let i = 0; i < 900; i++) { // Poll for up to 30 minutes
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/agents/scan?sourceId=${encodeURIComponent(sourceId)}`);
        if (res.ok) {
          const status = await res.json();
          setScanStatuses(prev => ({ ...prev, [sourceId]: status }));
          if (status.status === "completed" || status.status === "failed") {
            fetchSources(); // Refresh source list to update lastScannedAt
            break;
          }
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    }
  };

  useEffect(() => {
    fetchSources();
    fetchStatuses();
    fetchRunAll();
  }, []);

  const getStatus = (sourceId: string): ScanStatus => {
    return scanStatuses[sourceId] || { status: "idle" };
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleString("he-IL", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    } catch { return dateStr; }
  };

  const formatDuration = (start: number, end: number) => {
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const addCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdding(true);
    setAddError("");
    try {
      const response = await fetch("/api/agents/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "שמירת החברה נכשלה");
      await fetchSources();
      setAddOpen(false);
      setCompany({ type: "ats", name: "", slug: "", uid: "", token: "", domain: "", discoverFrom: "", url: "" });
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "שמירת החברה נכשלה");
    } finally {
      setAdding(false);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "board": return "לוח משרות";
      case "comeet": return "Comeet";
      case "ats": return "ATS";
      case "portal": return "דף משרות";
      case "company": return "חברה מלוח משרות";
      default: return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "board": return "badge-blue";
      case "comeet": return "badge-purple";
      case "ats": return "badge-green";
      case "portal": return "badge-blue";
      case "company": return "badge-gray";
      default: return "badge-gray";
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <h2 className="page-title">סוכני משרות</h2>
        <div className="loading">טוען מקורות...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">סוכני משרות</h2>
        <p className="page-sub">
          ניהול מקורות סריקה למשרות DevOps. כל כרטיס מייצג מקור שניתן לסרוק בנפרד.
        </p>
        <button className="btn btn-primary source-add-button" type="button" onClick={() => { setAddError(""); setAddOpen(true); }}><LuPlus aria-hidden="true" /> הוסף חברה</button>
      </div>

      <div className="run-all-bar">
        <button className="btn btn-primary" type="button" onClick={startRunAll} disabled={runAllActive}>
          {runAllActive ? <><span className="spinner"></span> מריץ סוכנים...</> : <><LuPlay aria-hidden="true" /> הרץ את כל הסוכנים</>}
        </button>
        <button className="btn btn-secondary" type="button" onClick={startDiscovery} disabled={discoveryActive}>
          {discoveryActive ? <><span className="spinner"></span> מחפש סוכנים חדשים...</> : <><LuSparkles aria-hidden="true" /> גלה והוסף סוכנים חדשים</>}
        </button>
        <label className="run-all-toggle">
          <input type="checkbox" checked={autoDiscover} onChange={(event) => setAutoDiscover(event.target.checked)} disabled={runAllActive} />
          הוסף סוכנים חדשים אוטומטית בסיום הריצה
        </label>
        {runAll && runAll.status !== "idle" && (
          <div className="run-all-progress" role="status">
            <progress max={runAll.total || 1} value={runAll.done} />
            <span>{runAll.done}/{runAll.total} סוכנים הסתיימו{runAll.failed ? ` · ${runAll.failed} נכשלו` : ""}{runAll.running.length ? ` · רצים כעת: ${runAll.running.length}` : ""}</span>
          </div>
        )}
        {runAll?.discovery && runAll.discovery.status !== "idle" && (
          <div className="run-all-progress" role="status">
            {runAll.discovery.status === "running" && <span>מחפש חברות חדשות עם לוח משרות ציבורי...</span>}
            {runAll.discovery.status === "completed" && (
              <span>
                נבדקו {runAll.discovery.result?.probed ?? 0} חברות · נוספו {runAll.discovery.result?.added?.length ?? 0} סוכנים
                {runAll.discovery.result?.added?.length ? `: ${runAll.discovery.result.added.map((a) => a.name).join(", ")}` : ""}
                {runAll.discovery.result?.remaining ? ` · ${runAll.discovery.result.remaining} ממתינות לבדיקה` : ""}
              </span>
            )}
            {runAll.discovery.status === "failed" && <span className="status-error">גילוי סוכנים נכשל: {runAll.discovery.error}</span>}
          </div>
        )}
      </div>

      <dialog ref={dialogRef} className="source-dialog" aria-labelledby="source-dialog-title" onClose={() => setAddOpen(false)}>
        <form className="source-dialog-form" onSubmit={addCompany}>
          <div className="source-dialog-heading">
            <h2 id="source-dialog-title">הוסף חברה לסריקה</h2>
            <button type="button" className="source-dialog-close" aria-label="סגור" title="סגור" onClick={() => setAddOpen(false)}><LuX aria-hidden="true" /></button>
          </div>
          <label className="source-dialog-field">סוג מקור
            <select value={company.type} onChange={(event) => setCompany({ ...company, type: event.target.value as "ats" | "comeet" })}>
              <option value="ats">ATS</option>
              <option value="comeet">Comeet</option>
              <option value="portal">דף משרות ציבורי</option>
            </select>
          </label>
          <label className="source-dialog-field">שם החברה
            <input required maxLength={120} value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} />
          </label>
          {company.type !== "comeet" ? (
            <label className="source-dialog-field">{company.type === "ats" ? "מזהה ATS" : "מזהה מקור"}
              <input required placeholder="company-slug" dir="ltr" value={company.slug} onChange={(event) => setCompany({ ...company, slug: event.target.value })} />
            </label>
          ) : (
            <>
              <label className="source-dialog-field">Comeet UID
                <input required placeholder="AA.005" dir="ltr" value={company.uid} onChange={(event) => setCompany({ ...company, uid: event.target.value })} />
              </label>
              <label className="source-dialog-field">Comeet token
                <input required minLength={16} pattern="[A-Za-z0-9]+" dir="ltr" value={company.token} onChange={(event) => setCompany({ ...company, token: event.target.value })} />
              </label>
            </>
          )}
          {company.type === "portal" ? (
            <label className="source-dialog-field">כתובת דף המשרות הציבורי
              <input type="url" required placeholder="https://company.com/careers" dir="ltr" value={company.url} onChange={(event) => setCompany({ ...company, url: event.target.value })} />
              <small>דף ציבורי עם קישורים למשרות בישראל. דפים שדורשים התחברות או נטענים רק ב-JavaScript אינם נתמכים.</small>
            </label>
          ) : (
            <label className="source-dialog-field">דומיין החברה (לא חובה)
              <input placeholder="company.com" dir="ltr" value={company.domain} onChange={(event) => setCompany({ ...company, domain: event.target.value })} />
            </label>
          )}
          {company.type === "comeet" && (
            <label className="source-dialog-field">קישור לדף המשרות (לא חובה)
              <input type="url" placeholder="https://company.com/careers" dir="ltr" value={company.discoverFrom} onChange={(event) => setCompany({ ...company, discoverFrom: event.target.value })} />
            </label>
          )}
          {addError && <p className="source-dialog-error" role="alert">{addError}</p>}
          <div className="source-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(false)}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={adding}>{adding ? "שומר..." : "הוסף חברה"}</button>
          </div>
        </form>
      </dialog>

      {summary && (
        <div className="summary-cards">
          <div className="summary-card">
            <span className="summary-value">{summary.total}</span>
            <span className="summary-label">סה"כ מקורות</span>
          </div>
          <div className="summary-card">
            <span className="summary-value">{summary.boards}</span>
            <span className="summary-label">לוחות משרות</span>
          </div>
          <div className="summary-card">
            <span className="summary-value">{summary.comeet}</span>
            <span className="summary-label">חברות Comeet</span>
          </div>
          <div className="summary-card">
            <span className="summary-value">{summary.ats}</span>
            <span className="summary-label">חברות ATS</span>
          </div>
          {!!summary.portals && <div className="summary-card">
            <span className="summary-value">{summary.portals}</span>
            <span className="summary-label">דפי משרות</span>
          </div>}
          {!!summary.companies && <div className="summary-card">
            <span className="summary-value">{summary.companies}</span>
            <span className="summary-label">חברות מלוחות משרות</span>
          </div>}
        </div>
      )}

      <div className="sources-grid">
        {sources.map((source) => {
          const status = getStatus(source.id);
          const isScanning = scanning === source.id || status.status === "running";
          const startedAt = scanning === source.id ? scanStartedAt : status.startedAt ? Date.parse(status.startedAt) : null;
          const finishedAt = status.finishedAt ? Date.parse(status.finishedAt) : null;
          
          return (
            <div key={source.id} className={`source-card${isScanning ? " is-scanning" : ""}`}>
              <div className="source-header">
                <div className="source-info">
                  <h3 className="source-name">{source.name}</h3>
                  <div className="source-meta">
                    <span className={`badge ${getTypeColor(source.type)}`}>{getTypeLabel(source.type)}</span>
                    {source.domain && <span className="source-domain">{source.domain}</span>}
                    {source.uid && <span className="source-uid">UID: {source.uid}</span>}
                    {source.slug && source.type !== "company" && <span className="source-slug">Slug: {source.slug}</span>}
                    {source.foundOn && <span className="source-domain">נמצאה ב-{source.foundOn}</span>}
                  </div>
                </div>
              </div>

              <div className="source-details">
                {source.discoverFrom && (
                  <a href={source.discoverFrom} target="_blank" rel="noopener noreferrer" className="discover-link">
                    דף גילוי ←
                  </a>
                )}
              </div>

              <div className="source-status">
                <div className="status-row">
                  <span className="status-label">סטטוס אחרון:</span>
                  <span className={`status-value status-${status.status}`}>
                    {status.status === "running" ? "רץ..." : 
                     status.status === "completed" ? "הושלם" : 
                     status.status === "failed" ? "נכשל" : "ממתין"}
                  </span>
                </div>
                <div className="status-row">
                  <span className="status-label">סריקה אחרונה:</span>
                  <span className="status-value">{formatDate(status.finishedAt || source.lastScannedAt)}</span>
                </div>
                {startedAt !== null && Number.isFinite(startedAt) && (isScanning || finishedAt !== null) && (
                  <div className="status-row">
                    <span className="status-label">{isScanning ? "זמן שחלף:" : "משך סריקה:"}</span>
                    <span className="status-value" role={isScanning ? "timer" : undefined}>{formatDuration(startedAt, isScanning ? now : finishedAt!)}</span>
                  </div>
                )}
                {status.result && (
                  <div className="status-row">
                    <span className="status-label">נמצאו:</span>
                    <span className="status-value">{status.result.scanned || 0} משרות ({status.result.saved || 0} נשמרו){status.result.agents_added ? ` · ${status.result.agents_added} סוכנים חדשים` : ""}</span>
                  </div>
                )}
                {status.error && (
                  <div className="status-error">{status.error}</div>
                )}
              </div>

              <div className="source-actions">
                <button
                  className="btn btn-primary source-scan-button"
                  onClick={() => handleRescan(source.id)}
                  disabled={isScanning}
                >
                  {isScanning ? (
                    <>
                      <span className="spinner"></span> סורק...
                    </>
                  ) : (
                    "סרוק עכשיו"
                  )}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => router.push(`/agents/${encodeURIComponent(source.id)}`)}
                >
                  פרטים
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {sources.length === 0 && (
        <div className="empty-state">
          לא נמצאו מקורות סריקה. בדוק את קבצי הקונפיגורציה ב-agents/config/
        </div>
      )}


            <div className="source-card wa-border">
        <div className="source-header">
          <div className="source-info">
            <h3 className="source-name">WhatsApp</h3>
            <div className="source-meta">
              <span className="badge badge-wa">WhatsApp</span>
              <span className="source-domain">סריקת קבוצות</span>
            </div>
          </div>
        </div>
        <div className="source-details">
          <p className="page-sub" style={{ margin: 0 }}>
            קבוצות WhatsApp נסרקות בלשונית ייעודית: חיבור חשבון, ניטור קבוצות וחילוץ
            משרות DevOps לאותו טבלה.
          </p>
        </div>
        <div className="source-actions">
          <Link href="/whatsapp" className="btn btn-primary">פתח את הלשונית</Link>
          <Link href="/whatsapp/jobs" className="btn btn-secondary">משרות שחולצו</Link>
        </div>
      </div>
    </div>
  );
}