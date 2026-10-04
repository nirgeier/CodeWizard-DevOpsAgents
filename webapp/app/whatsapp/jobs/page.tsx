import Link from "next/link";
import { listJobs } from "@/lib/db";
import type { DevOpsJob } from "@/lib/types";

export const dynamic = "force-dynamic";

function when(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function groupOf(job: DevOpsJob): string | null {
  const tags = Array.isArray(job.tags) ? job.tags : [];
  // The extractor stashes the originating group JID in tags.
  const jid = tags.find((t) => typeof t === "string" && t.includes("@g.us"));
  return jid ?? null;
}

/** The group name the extractor also saved, used when no company was named. */
function groupNameOf(job: DevOpsJob): string | null {
  const tags = Array.isArray(job.tags) ? job.tags : [];
  const name = tags.find(
    (t) => typeof t === "string" && t !== "whatsapp" && !t.includes("@g.us") && !t.includes("@s."),
  );
  return name ?? null;
}

export default async function WhatsAppJobsPage() {
  const jobs = await listJobs({ source: "whatsapp", limit: 300 });
  const scanned = jobs.filter((j) => j.posted_at);

  return (
    <div className="page-container">
      <div className="page-header">
        <Link href="/whatsapp" className="discover-link">← חזרה לסריקת WhatsApp</Link>
        <h2 className="page-title">משרות מ-WhatsApp</h2>
        <p className="page-sub">
          משרות שחולצו מקבוצות WhatsApp ונשמרו ל-<code>devops_jobs</code>.
        </p>
      </div>

      <div className="summary-cards">
        <div className="summary-card">
          <span className="summary-value">{jobs.length}</span>
          <span className="summary-label">סה"כ משרות</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{new Set(jobs.map(groupOf).filter(Boolean)).size}</span>
          <span className="summary-label">קבוצות</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">
            {jobs.length ? Math.round((jobs[0].score as number) * 100) : 0}
          </span>
          <span className="summary-label">ניקוד עליון</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{scanned.length}</span>
          <span className="summary-label">עם תאריך פרסום</span>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state">
          עדיין לא חולצו משרות. סמנו קבוצה לניטור בלשונית <Link href="/whatsapp">WhatsApp</Link> והפעילו ״חלץ משרות״.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>כותרת</th>
                <th>חברה</th>
                <th>מיקום</th>
                <th>רמת</th>
                <th>ניקוד</th>
                <th>מילות מפתח</th>
                <th>פורסם</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    {job.url ? (
                      <a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a>
                    ) : (
                      job.title
                    )}
                  </td>
                  <td>
                    {job.company || (
                      <span className="cell-muted" title="החברה לא צוינה בפוסט">
                        {groupNameOf(job) || "לא צוינה"}
                      </span>
                    )}
                  </td>
                  <td>{job.location || <span className="cell-muted">—</span>}</td>
                  <td>{job.seniority || <span className="cell-muted">—</span>}</td>
                  <td>
                    <span className="badge conf-green">{Number(job.score).toFixed(2)}</span>
                  </td>
                  <td className="cell-muted">
                    {(job.keywords || []).slice(0, 5).join(", ") || "—"}
                  </td>
                  <td className="nowrap">{when(job.posted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}