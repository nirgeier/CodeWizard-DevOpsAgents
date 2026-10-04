import Link from "next/link";
import { listOpportunities } from "@/lib/db";
import { ConfidenceBadge, StatusBadge } from "@/components/Badges";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUSES = [
  "new",
  "review",
  "approved",
  "rejected",
  "contacted",
  "meeting",
import { facet, pageOpportunities } from "@/lib/db";
import { ConfidenceBadge, StatusBadge } from "@/components/Badges";
import { formatDate } from "@/lib/format";
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
export const metadata = { title: "הזדמנויות" };

const BASE = "/opportunities";

const SPEC: ListParamsSpec = {
  sortable: ["confidence", "company_name", "status", "location", "created_at"],
  defaultSort: "confidence",
  defaultDir: "desc",
  filters: ["status", "minConfidence"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

/** Pipeline order, so the dropdown reads as a funnel rather than by frequency. */
const STATUS_ORDER = [
  "new",
  "review",
  "approved",
  "contacted",
  "meeting",
  "rejected",
  "lost",
  "archived",
];

const CONFIDENCE_OPTIONS = [
  { value: "", label: "הכל" },
  { value: "0.80", label: "≥ 0.80" },
  { value: "0.70", label: "≥ 0.70" },
  { value: "0.65", label: "≥ 0.65" },
const STATUS_LABELS: Record<string, string> = {
  new: "חדש",
  review: "לבדיקה",
  approved: "אושר",
  rejected: "נדחה",
  contacted: "נוצר קשר",
  meeting: "פגישה",
  lost: "אבוד",
  archived: "בארכיון",
};

const CONFIDENCE_OPTIONS = [
  { value: "0.80", label: "≥ 0.80" },
  { value: "0.70", label: "≥ 0.70" },
  { value: "0.65", label: "≥ 0.65" },
  { value: "0.50", label: "≥ 0.50" },
];

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; minConfidence?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status || "";
  const minConfidence = sp.minConfidence ? Number(sp.minConfidence) : null;

  const items = await listOpportunities({
    status: status || null,
    minConfidence,
    limit: 500,
  });

  return (
    <div>
      <h2 className="page-title">הזדמנויות</h2>
      <p className="page-sub">כל הזדמנויות המכירה, מסוננות לפי סטטוס ורמת ביטחון.</p>

      <form className="filters" method="get">
        <div className="field">
          <label htmlFor="status">סטטוס</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="">הכל</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="minConfidence">ביטחון מינימלי</label>
          <select
            id="minConfidence"
            name="minConfidence"
            defaultValue={sp.minConfidence || ""}
          >
            {CONFIDENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          סנן
        </button>
        <Link className="btn btn-ghost" href="/opportunities">
          נקה
        </Link>
      </form>

      {items.length === 0 ? (
        <div className="empty">לא נמצאו הזדמנויות התואמות את הסינון.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>חברה</th>
                <th>איש קשר</th>
                <th>פרסונה</th>
                <th>ביטחון</th>
                <th>סטטוס</th>
                <th>מיקום</th>
                <th>נוצר</th>
              </tr>
            </thead>
            <tbody>
              {items.map((opp) => (
                <tr key={opp.id}>
                  <td>
                    <Link href={`/opportunities/${opp.id}`}>
                      {opp.company_name || "-"}
                    </Link>
                    {opp.domain ? (
                      <div className="cell-muted">{opp.domain}</div>
                    ) : null}
                  </td>
                  <td>
                    {opp.target_person_name || "-"}
                    {opp.target_title ? (
                      <div className="cell-muted">{opp.target_title}</div>
                    ) : null}
                  </td>
                  <td className="cell-muted">{opp.persona || "-"}</td>
                  <td>
                    <ConfidenceBadge value={opp.confidence} />
                  </td>
                  <td>
                    <StatusBadge status={opp.status} />
                  </td>
                  <td className="cell-muted">{opp.location || "-"}</td>
                  <td className="cell-muted nowrap">
                    {formatDate(opp.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
  searchParams: Promise<RawParams>;
}) {
  const params = parseListParams(await searchParams, SPEC);

  // Independent reads, so they go out together rather than in series.
  const [result, statusFacet] = await Promise.all([
    pageOpportunities(params),
    facet("opportunities", "status"),
  ]);

  const statusOptions = [...statusFacet]
    .sort((a, b) => STATUS_ORDER.indexOf(a.value) - STATUS_ORDER.indexOf(b.value))
    .map((o) => ({
      value: o.value,
      label: STATUS_LABELS[o.value] ?? o.value,
      count: o.count,
    }));

  const filters: FilterSpec[] = [
    { key: "status", label: "סטטוס", options: statusOptions },
    {
      key: "minConfidence",
      label: "ביטחון",
      options: CONFIDENCE_OPTIONS,
      allLabel: "כל הרמות",
    },
  ];

  const filtered = hasActiveFilters(params);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">הזדמנויות</h2>
        <p className="page-sub">
          כל הזדמנויות המכירה. סננו לפי סטטוס ורמת ביטחון, או חפשו חברה, איש קשר
          או מיקום.
        </p>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש חברה, איש קשר, תפקיד או מיקום…"
        total={result.total}
      />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין הזדמנויות התואמות את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו חלק מהמסננים."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="עדיין אין הזדמנויות"
            hint="הריצו סריקה כדי לייצר הזדמנויות מתוך איתותי השוק."
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
                    column="company_name"
                    label="חברה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <th>איש קשר</th>
                  <th>פרסונה</th>
                  <SortHeader
                    column="confidence"
                    label="ביטחון"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <SortHeader
                    column="status"
                    label="סטטוס"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="location"
                    label="מיקום"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="created_at"
                    label="נוצר"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                </tr>
              </thead>
              <tbody>
                {result.items.map((opp) => (
                  <tr key={opp.id}>
                    <td>
                      <Link href={`/opportunities/${opp.id}`} className="row-link">
                        {opp.company_name || "-"}
                      </Link>
                      {opp.domain ? (
                        <div className="cell-muted">{opp.domain}</div>
                      ) : null}
                    </td>
                    <td>
                      {opp.target_person_name || "-"}
                      {opp.target_title ? (
                        <div className="cell-muted">{opp.target_title}</div>
                      ) : null}
                    </td>
                    <td className="cell-muted">{opp.persona || "-"}</td>
                    <td>
                      <ConfidenceBadge value={opp.confidence} />
                    </td>
                    <td>
                      <StatusBadge status={opp.status} />
                    </td>
                    <td className="cell-muted">{opp.location || "-"}</td>
                    <td className="cell-muted nowrap">{formatDate(opp.created_at)}</td>
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
            unit="הזדמנויות"
          />
        </>
      )}
    </div>
  );
}
