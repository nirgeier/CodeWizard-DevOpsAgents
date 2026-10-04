import { listScans } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ScansPage() {
  const items = await listScans({ limit: 200 });

  return (
    <div>
      <h2 className="page-title">סריקות</h2>
      <p className="page-sub">היסטוריית ריצות של סוכן הסריקה וסטטוס התוצאות.</p>

      {items.length === 0 ? (
        <div className="empty">לא נמצאו סריקות.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>סטטוס</th>
                <th>התחלה</th>
                <th>סיום</th>
                <th>איתותים</th>
                <th>חברות</th>
                <th>אנשים</th>
                <th>הזדמנויות</th>
                <th>שגיאה</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="badge type">{s.status || "-"}</span>
                  </td>
                  <td className="cell-muted nowrap">
                    {formatDateTime(s.started_at)}
                  </td>
                  <td className="cell-muted nowrap">
                    {formatDateTime(s.finished_at)}
                  </td>
                  <td>{s.market_signals ?? 0}</td>
                  <td>{s.company_profiles ?? 0}</td>
                  <td>{s.people_profiles ?? 0}</td>
                  <td>
                    {s.opportunities_saved ?? 0} / {s.opportunities_found ?? 0}
                  </td>
                  <td className="cell-muted">
                    {s.error ? (
                      <span style={{ color: "#a52b2b" }}>{s.error}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
import { facet, pageScans } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
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

export const dynamic = "force-dynamic";
export const metadata = { title: "סריקות" };

const BASE = "/scans";

const SPEC: ListParamsSpec = {
  sortable: ["started_at", "status", "opportunities_found", "duration_ms"],
  defaultSort: "started_at",
  defaultDir: "desc",
  filters: ["status"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

function duration(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1000) return `${n}ms`;
  const seconds = n / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function statusTone(status: unknown): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "completed" || s === "ok" || s === "success") return "conf-green";
  if (s === "running" || s === "pending") return "conf-blue";
  if (s === "failed" || s === "error") return "conf-red";
  return "type";
}

export default async function ScansPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = parseListParams(await searchParams, SPEC);

  const [result, statusFacet] = await Promise.all([
    pageScans(params),
    facet("scans", "status"),
  ]);

  const filters: FilterSpec[] = [
    {
      key: "status",
      label: "סטטוס",
      options: statusFacet.map((o) => ({
        value: o.value,
        label: o.value,
        count: o.count,
      })),
    },
  ];

  const filtered = hasActiveFilters(params);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">סריקות</h2>
        <p className="page-sub">היסטוריית ריצות של סוכן הסריקה וסטטוס התוצאות.</p>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש מצב, שאילתה או שגיאה…"
        total={result.total}
      />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין סריקות התואמות את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו את המסנן."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="עדיין לא בוצעו סריקות"
            hint="כל ריצה של סוכן תירשם כאן עם מספרי התוצאות שלה."
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
                    column="status"
                    label="סטטוס"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="started_at"
                    label="התחלה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>סיום</th>
                  <SortHeader
                    column="duration_ms"
                    label="משך"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>איתותים</th>
                  <th>חברות</th>
                  <th>אנשים</th>
                  <SortHeader
                    column="opportunities_found"
                    label="הזדמנויות"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>שגיאה</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className={`badge ${statusTone(s.status)}`}>
                        {s.status || "-"}
                      </span>
                    </td>
                    <td className="cell-muted nowrap">{formatDateTime(s.started_at)}</td>
                    <td className="cell-muted nowrap">{formatDateTime(s.finished_at)}</td>
                    <td className="cell-muted nowrap">{duration(s.duration_ms)}</td>
                    <td>{s.market_signals ?? 0}</td>
                    <td>{s.company_profiles ?? 0}</td>
                    <td>{s.people_profiles ?? 0}</td>
                    <td>
                      {s.opportunities_saved ?? 0} / {s.opportunities_found ?? 0}
                    </td>
                    <td className="cell-muted">
                      {s.error ? (
                        <span className="cell-error" title={s.error}>
                          {s.error}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
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
            unit="סריקות"
          />
        </>
      )}
    </div>
  );
}
