import Link from "next/link";
import { getPreferences, pageJobs } from "@/lib/db";
import { parseListParams, type ListParamsSpec, type RawParams } from "@/lib/query";
import Pagination from "@/components/Pagination";

export const dynamic = "force-dynamic";
export const metadata = { title: "התראות משרות" };

const BASE = "/jobs/alerts";

const SPEC: ListParamsSpec = {
  sortable: ["posted_at"],
  defaultSort: "posted_at",
  defaultDir: "desc",
  defaultPageSize: 25,
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir, defaultPageSize: SPEC.defaultPageSize };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const params = parseListParams(await searchParams, SPEC);
  const preferences = await getPreferences();
  const enabled = Boolean(preferences?.alerts_enabled);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = enabled
    ? await pageJobs({
        page: params.page,
        pageSize: params.pageSize,
        sort: params.sort,
        dir: params.dir,
        filters: { firstSeenSince: since, minScore: String((preferences?.alert_min_score ?? 70) / 100) },
      })
    : null;

  const pager = (placement: "top" | "bottom") =>
    result ? (
      <Pagination
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        unit="משרות"
        placement={placement}
      />
    ) : null;

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">התראות משרות</h2>
        <p className="page-sub">משרות שנמצאו בשבעת הימים האחרונים עם התאמה של {preferences?.alert_min_score ?? 70}% ומעלה.</p>
      </div>
      {!enabled ? (
        <p>ההתראות כבויות. <Link href="/settings">הפעילו אותן בהגדרות</Link>.</p>
      ) : !result || result.total === 0 ? (
        <p>אין משרות חדשות התואמות לסף שבחרתם.</p>
      ) : (
        <>
          {pager("top")}
          <div className="table-wrap"><table>
            <thead><tr><th>משרה</th><th>חברה</th><th>מקור</th><th>התאמה</th><th>נצפתה לראשונה</th></tr></thead>
            <tbody>{result.items.map((job) => (
              <tr key={job.id}>
                <td>{job.url ? <a className="row-link" href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a> : job.title}</td>
                <td>{job.company || "—"}</td><td>{job.source}</td>
                <td>{Math.round(Number(job.score) * 100)}%{job.fit_matches?.length ? ` · ${job.fit_matches.map((match) => match.term).join(", ")}` : ""}</td>
                <td>{job.first_seen_at ? new Date(job.first_seen_at).toLocaleDateString("he-IL") : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {pager("bottom")}
        </>
      )}
    </div>
  );
}
