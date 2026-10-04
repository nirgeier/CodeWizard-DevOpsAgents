import { facet, pageSignals } from "@/lib/db";
import { TypeBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/format";
import {
  hasActiveFilters,
  parseListParams,
  type ListParamsSpec,
  type RawParams,
} from "@/lib/query";
import DataToolbar, { type FilterSpec } from "@/components/DataToolbar";
import Pagination from "@/components/Pagination";
import SortSelect from "@/components/SortSelect";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "איתותים" };

const BASE = "/signals";

const SPEC: ListParamsSpec = {
  sortable: ["occurred_at", "company_name", "type", "source", "relevance"],
  defaultSort: "occurred_at",
  defaultDir: "desc",
  filters: ["type", "source"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

const SORT_CHOICES = [
  { value: "occurred_at:desc", label: "חדש ביותר" },
  { value: "occurred_at:asc", label: "ישן ביותר" },
  { value: "relevance:desc", label: "רלוונטיות" },
  { value: "company_name:asc", label: "חברה (א־ת)" },
  { value: "type:asc", label: "סוג איתות" },
];

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = parseListParams(await searchParams, SPEC);

  const [result, typeFacet, sourceFacet] = await Promise.all([
    pageSignals(params),
    facet("signals", "type"),
    facet("signals", "source"),
  ]);

  const filters: FilterSpec[] = [
    {
      key: "type",
      label: "סוג",
      options: typeFacet.map((o) => ({ value: o.value, label: o.value, count: o.count })),
    },
    {
      key: "source",
      label: "מקור",
      options: sourceFacet.map((o) => ({ value: o.value, label: o.value, count: o.count })),
    },
  ];

  const filtered = hasActiveFilters(params);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">איתותים</h2>
        <p className="page-sub">
          איתותי שוק, גיוסים ואירועים המזינים את ההזדמנויות.
        </p>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש כותרת, חברה או מקור…"
        total={result.total}
      >
        <SortSelect
          basePath={BASE}
          params={params}
          defaults={DEFAULTS}
          choices={SORT_CHOICES}
        />
      </DataToolbar>

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין איתותים התואמים את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו חלק מהמסננים."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="עדיין אין איתותים"
            hint="איתותים נאספים בכל סריקה. הריצו סוכן כדי למלא את הרשימה."
            action={{ href: "/agents", label: "להרצת סוכן" }}
          />
        )
      ) : (
        <>
          <div className="stack">
            {result.items.map((sig) => (
              <article className="card card-hover" key={sig.id}>
                <div className="row-between">
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <TypeBadge type={sig.type} />
                    <strong>{sig.company_name || "-"}</strong>
                  </div>
                  <span className="cell-muted nowrap">
                    {formatDateTime(sig.occurred_at || sig.ingested_at)}
                  </span>
                </div>
                <div className="signal-headline" style={{ marginTop: 8 }}>
                  {sig.url ? (
                    <a href={sig.url} target="_blank" rel="noreferrer">
                      {sig.headline || sig.url}
                    </a>
                  ) : (
                    sig.headline || "-"
                  )}
                </div>
                {sig.summary ? (
                  <div className="signal-summary">{sig.summary}</div>
                ) : null}
                <div
                  className="cell-muted"
                  style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}
                >
                  <span>מקור: {sig.source || "-"}</span>
                  {sig.location ? <span>מיקום: {sig.location}</span> : null}
                  {sig.url ? (
                    <a href={sig.url} target="_blank" rel="noreferrer">
                      קישור למקור ↗
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <Pagination
            basePath={BASE}
            params={params}
            defaults={DEFAULTS}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            totalPages={result.totalPages}
            unit="איתותים"
          />
        </>
      )}
    </div>
  );
}
