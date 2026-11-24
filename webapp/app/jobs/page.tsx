import Link from "next/link";
import { facet, pageJobs } from "@/lib/db";
import type { DevOpsJob } from "@/lib/types";
import {
  hasActiveFilters,
  parseListParams,
  type ListParamsSpec,
  type RawParams,
} from "@/lib/query";
import DataToolbar, { type FilterSpec } from "@/components/DataToolbar";
import Pagination from "@/components/Pagination";
import SortHeader from "@/components/SortHeader";
import EmptyState from "@/components/EmptyState";
import JobTrackerActions from "@/components/JobTrackerActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "משרות DevOps" };

const BASE = "/jobs";

const SPEC: ListParamsSpec = {
  sortable: ["score", "title", "company", "posted_at", "seniority"],
  defaultSort: "score",
  defaultDir: "desc",
  filters: ["source", "seniority", "workMode", "minScore"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

const SCORE_OPTIONS = [
  { value: "0.9", label: "≥ 0.90" },
  { value: "0.75", label: "≥ 0.75" },
  { value: "0.5", label: "≥ 0.50" },
];

function when(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

/**
 * The WhatsApp extractor stashes the originating group name in `tags`
 * alongside the group JID, and uses it when the post named no company.
 */
function groupNameOf(job: DevOpsJob): string | null {
  const tags = Array.isArray(job.tags) ? job.tags : [];
  return (
    tags.find(
      (t) =>
        typeof t === "string" &&
        t !== "whatsapp" &&
        !t.includes("@g.us") &&
        !t.includes("@s."),
    ) ?? null
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = parseListParams(await searchParams, SPEC);

  const [result, sourceFacet, seniorityFacet, workModeFacet] = await Promise.all([
    pageJobs(params),
    facet("devops_jobs", "source"),
    facet("devops_jobs", "seniority"),
    facet("devops_jobs", "work_mode"),
  ]);

  const filters: FilterSpec[] = [
    {
      key: "source",
      label: "מקור",
      options: sourceFacet.map((o) => ({
        value: o.value,
        label: o.value,
        count: o.count,
      })),
      allLabel: "כל המקורות",
    },
    {
      key: "seniority",
      label: "רמה",
      options: seniorityFacet.map((o) => ({
        value: o.value,
        label: o.value,
        count: o.count,
      })),
    },
    {
      key: "workMode",
      label: "אופן עבודה",
      options: workModeFacet.map((option) => ({
        value: option.value,
        label: ({ remote: "מרחוק", hybrid: "היברידי", onsite: "באתר" } as Record<string, string>)[option.value] || option.value,
        count: option.count,
      })),
      allLabel: "כל אופני העבודה",
    },
    { key: "minScore", label: "ניקוד", options: SCORE_OPTIONS, allLabel: "כל הניקודים" },
  ];

  const filtered = hasActiveFilters(params);
  const withDate = result.items.filter((j) => j.posted_at).length;
  const topScore = result.items.length
    ? Math.round(Number(result.items[0].score) * 100)
    : 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">משרות DevOps</h2>
        <p className="page-sub">
          כל המשרות שנסרקו ונשמרו ל-<code>devops_jobs</code>, מכל המקורות.
          לסריקת קבוצות WhatsApp עברו ל<Link href="/whatsapp">לשונית WhatsApp</Link>.
        </p>
        <Link className="job-tracker-link" href="/applications">מעקב משרות שמורות והגשות</Link>
      </div>

      <div className="summary-cards">
        <div className="summary-card">
          <span className="summary-value">{result.total.toLocaleString("he-IL")}</span>
          <span className="summary-label">משרות תואמות</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{sourceFacet.length}</span>
          <span className="summary-label">מקורות</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{topScore}</span>
          <span className="summary-label">ניקוד עליון בעמוד</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{withDate}</span>
          <span className="summary-label">עם תאריך פרסום</span>
        </div>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש כותרת, חברה, מיקום או מחלקה…"
        total={result.total}
      />

      <Pagination basePath={BASE} params={params} defaults={DEFAULTS}
        page={result.page} pageSize={result.pageSize} total={result.total}
        totalPages={result.totalPages} unit="משרות" placement="top" />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין משרות התואמות את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו חלק מהמסננים."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="עדיין לא נסרקו משרות"
            hint="הריצו סוכן סריקה, או חלצו משרות מקבוצת WhatsApp."
            action={{ href: "/agents", label: "להרצת סוכן" }}
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortHeader
                    column="title"
                    label="כותרת"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="company"
                    label="חברה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <th>מקור</th>
                  <th>מיקום</th>
                  <th>אופן עבודה</th>
                  <SortHeader
                    column="seniority"
                    label="רמה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="score"
                    label="ניקוד"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>מילות מפתח</th>
                  <th>מעקב</th>
                  <SortHeader
                    column="posted_at"
                    label="פורסם"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                </tr>
              </thead>
              <tbody>
                {result.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {job.url ? (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="row-link"
                        >
                          {job.title}
                        </a>
                      ) : (
                        <span className="row-link">{job.title}</span>
                      )}
                    </td>
                    <td>
                      {job.company || (
                        <span className="cell-muted" title="החברה לא צוינה בפוסט">
                          {groupNameOf(job) || "לא צוינה"}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="badge type">{job.source || "-"}</span>
                    </td>
                    <td className="cell-muted">
                      {job.location || <span className="cell-muted">—</span>}
                    </td>
                    <td className="cell-muted">{({ remote: "מרחוק", hybrid: "היברידי", onsite: "באתר" } as Record<string, string>)[job.work_mode || ""] || job.work_mode || "—"}</td>
                    <td className="cell-muted">{job.seniority || "—"}</td>
                    <td>
                      <span className="badge conf-green">
                        {Number(job.score).toFixed(2)}
                      </span>
                      {job.fit_matches?.length ? (
                        <span className="cell-muted" title={job.fit_matches.map(({ term, weight }) => `${term}: ${weight}`).join(", ")}>
                          {" "}{job.fit_matches.map(({ term }) => term).join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="cell-muted">
                      {(job.keywords || []).slice(0, 4).join(", ") || "—"}
                    </td>
                    <td><JobTrackerActions job={{ id: job.id, title: job.title, company: job.company || "", url: job.url || "" }} /></td>
                    <td className="cell-muted nowrap">{when(job.posted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            basePath={BASE}
            params={params}
            defaults={DEFAULTS}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            totalPages={result.totalPages}
            unit="משרות"
            placement="bottom"
          />
        </>
      )}
    </div>
  );
}
