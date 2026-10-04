"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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

interface Job {
  id: string;
  external_id: string | null;
  source: string;
  title: string;
  company: string | null;
  company_domain: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  work_mode: string | null;
  employment: string | null;
  seniority: string | null;
  department: string | null;
  url: string | null;
  description: string | null;
  posted_at: string | null;
  posted_text: string | null;
  keywords: string[];
  tags: string[];
  score: number | string;
  is_devops: boolean;
  raw: Record<string, unknown> | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  ingested_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ScanStatus {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  result?: any;
  error?: string;
}

interface JobsResponse {
  jobs: Job[];
}

export default function AgentDetailPage() {
  const params = useParams();
  const sourceId = params.id as string;

  const [source, setSource] = useState<Source | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ status: "idle" });
  const [scanning, setScanning] = useState(false);

  const fetchSource = async () => {
    try {
      const res = await fetch("/api/agents/sources");
      if (res.ok) {
        const data = await res.json();
        const found = data.sources.find((s: Source) => s.id === sourceId);
        setSource(found || null);
      }
    } catch (err) {
      console.error("Failed to fetch source:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`/api/agents/jobs?source=${encodeURIComponent(sourceId)}&limit=200`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setJobsLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/agents/scan?sourceId=${encodeURIComponent(sourceId)}`);
      if (res.ok) {
        const status = await res.json();
        setScanStatus(status);
      }
    } catch (err) {
      console.error("Failed to fetch scan status:", err);
    }
  };

  const handleRescan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/agents/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, options: { pages: 2 } }),
      });
      if (res.ok) {
        pollStatus();
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
    } finally {
      setScanning(false);
    }
  };

  const pollStatus = async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/agents/scan?sourceId=${encodeURIComponent(sourceId)}`);
        if (res.ok) {
          const status = await res.json();
          setScanStatus(status);
          if (status.status === "completed" || status.status === "failed") {
            fetchJobs();
            fetchSource(); // Refresh to update lastScannedAt
            break;
          }
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    }
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleString("he-IL", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "board":
        return "לוח משרות";
      case "comeet":
        return "Comeet";
      case "ats":
        return "ATS";
      default:
        return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "board":
        return "badge-blue";
      case "comeet":
        return "badge-purple";
      case "ats":
        return "badge-green";
      default:
        return "badge-gray";
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <Link href="/agents" className="back-link">← חזרה לסוכנים</Link>
          <h2 className="page-title">טוען...</h2>
        </div>
        <div className="loading">טוען פרטי מקור...</div>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="page-container">
        <div className="page-header">
          <Link href="/agents" className="back-link">← חזרה לסוכנים</Link>
          <h2 className="page-title">מקור לא נמצא</h2>
        </div>
        <div className="empty-state">
          מקור עם מזהה "{sourceId}" לא נמצא.
        </div>
      </div>
    );
  }

  const isScanning = scanning || scanStatus.status === "running";

  return (
    <div className="page-container">
      <div className="page-header">
        <Link href="/agents" className="back-link">← חזרה לסוכנים</Link>
        <div>
          <h2 className="page-title">{source.name}</h2>
          <div className="source-meta">
            <span className={`badge ${getTypeColor(source.type)}`}>{getTypeLabel(source.type)}</span>
            {source.domain && <span className="source-domain">{source.domain}</span>}
            {source.uid && <span className="source-uid">UID: {source.uid}</span>}
            {source.slug && <span className="source-slug">Slug: {source.slug}</span>}
          </div>
        </div>
      </div>

      <div className="source-header-card">
        <div className="source-details">
          {source.discoverFrom && (
            <a href={source.discoverFrom} target="_blank" rel="noopener noreferrer" className="discover-link">
              דף גילוי ←
            </a>
          )}
        </div>

        <div className="source-status">
          <div className="status-row">
            <span className="status-label">סטטוס סריקה:</span>
            <span className={`status-value status-${scanStatus.status}`}>
              {scanStatus.status === "running" ? "רץ..." :
               scanStatus.status === "completed" ? "הושלם" :
               scanStatus.status === "failed" ? "נכשל" : "ממתין"}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">סריקה אחרונה:</span>
            <span className="status-value">{formatDate(scanStatus.finishedAt || source.lastScannedAt)}</span>
          </div>
          {scanStatus.result && (
            <div className="status-row">
              <span className="status-label">נמצאו:</span>
              <span className="status-value">{scanStatus.result.scanned || 0} משרות ({scanStatus.result.saved || 0} נשמרו)</span>
            </div>
          )}
          {scanStatus.error && (
            <div className="status-error">{scanStatus.error}</div>
          )}
        </div>

        <div className="source-actions">
          <button
            className={`btn btn-primary ${isScanning ? "loading" : ""}`}
            onClick={handleRescan}
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
        </div>
      </div>

      <div className="jobs-section">
        <div className="jobs-header">
          <h3 className="jobs-title">משרות שנמצאו ({jobs.length})</h3>
        </div>

        {jobsLoading ? (
          <div className="loading">טוען משרות...</div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            לא נמצאו משרות ממקור זה. לחץ על "סרוק עכשיו" כדי להתחיל סריקה.
          </div>
        ) : (
          <div className="jobs-grid">
            {jobs.map((job) => (
              <div key={job.id} className="job-card">
                <div className="job-header">
                  <h4 className="job-title">{job.title}</h4>
                  <span className={`job-score ${job.is_devops ? "devops" : ""}`}>
                    Score: {Number(job.score).toFixed(2)}
                  </span>
                </div>
                <div className="job-meta">
                  {job.company && <span className="job-company">{job.company}</span>}
                  {job.location && <span className="job-location">📍 {job.location}</span>}
                  {job.work_mode && <span className="job-workmode">{job.work_mode}</span>}
                  {job.seniority && <span className="job-seniority">{job.seniority}</span>}
                </div>
                {job.url && (
                  <a href={job.url} target="_blank" rel="noopener noreferrer" className="job-link">
                    צפייה במודעה ←
                  </a>
                )}
                {job.description && (
                  <div className="job-description">{job.description.slice(0, 300)}...</div>
                )}
                {job.keywords.length > 0 && (
                  <div className="job-keywords">
                    {job.keywords.slice(0, 8).map((kw) => (
                      <span key={kw} className="keyword-badge">{kw}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}