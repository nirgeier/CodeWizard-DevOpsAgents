"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Source {
  id: string;
  name: string;
  type: "board" | "comeet" | "ats";
  domain?: string;
  uid?: string;
  slug?: string;
  discoverFrom?: string;
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
  summary: { total: number; boards: number; comeet: number; ats: number };
}

export default function AgentsPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [summary, setSummary] = useState<SourcesResponse["summary"] | null>(null);
  const [scanStatuses, setScanStatuses] = useState<Record<string, ScanStatus>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const router = useRouter();

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
    try {
      const res = await fetch("/api/agents/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, options: { pages: 2 } }),
      });
      if (res.ok) {
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
    for (let i = 0; i < 30; i++) { // Poll for up to 60 seconds
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/agents/scan?sourceId=${sourceId}`);
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

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "board": return "לוח משרות";
      case "comeet": return "Comeet";
      case "ats": return "ATS";
      default: return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "board": return "badge-blue";
      case "comeet": return "badge-purple";
      case "ats": return "badge-green";
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
      </div>

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
        </div>
      )}

      <div className="sources-grid">
        {sources.map((source) => {
          const status = getStatus(source.id);
          const isScanning = scanning === source.id || status.status === "running";
          
          return (
            <div key={source.id} className="source-card">
              <div className="source-header">
                <div className="source-info">
                  <h3 className="source-name">{source.name}</h3>
                  <div className="source-meta">
                    <span className={`badge ${getTypeColor(source.type)}`}>{getTypeLabel(source.type)}</span>
                    {source.domain && <span className="source-domain">{source.domain}</span>}
                    {source.uid && <span className="source-uid">UID: {source.uid}</span>}
                    {source.slug && <span className="source-slug">Slug: {source.slug}</span>}
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
                {status.result && (
                  <div className="status-row">
                    <span className="status-label">נמצאו:</span>
                    <span className="status-value">{status.result.scanned || 0} משרות ({status.result.saved || 0} נשמרו)</span>
                  </div>
                )}
                {status.error && (
                  <div className="status-error">{status.error}</div>
                )}
              </div>

              <div className="source-actions">
                <button
                  className={`btn btn-primary ${isScanning ? "loading" : ""}`}
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
                  onClick={() => router.push(`/agents/${source.id}`)}
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