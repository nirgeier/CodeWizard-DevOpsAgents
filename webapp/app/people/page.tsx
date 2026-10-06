import { facet, pagePeople } from "@/lib/db";
import { confidenceText, toNumber } from "@/lib/format";
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
export const metadata = { title: "אנשי קשר" };

const BASE = "/people";

const SPEC: ListParamsSpec = {
  sortable: ["relevance", "full_name", "company_name", "title", "seniority"],
  defaultSort: "relevance",
  defaultDir: "desc",
  filters: ["seniority", "persona", "contact"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

function relevanceClass(value: unknown): string {
  const v = toNumber(value);
  if (v >= 0.8) return "conf-green";
  if (v >= 0.7) return "conf-blue";
  if (v >= 0.65) return "conf-amber";
  return "conf-grey";
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = parseListParams(await searchParams, SPEC);

  const [result, seniorityFacet, personaFacet] = await Promise.all([
    pagePeople(params),
    facet("people", "seniority"),
    facet("people", "persona"),
  ]);

  const filters: FilterSpec[] = [
    {
      key: "seniority",
      label: "בכירות",
      options: seniorityFacet.map((o) => ({
        value: o.value,
        label: o.value,
        count: o.count,
      })),
    },
    {
      key: "persona",
      label: "פרסונה",
      options: personaFacet.map((o) => ({
        value: o.value,
        label: o.value,
        count: o.count,
      })),
    },
    {
      key: "contact",
      label: "פרטי קשר",
      options: [
        { value: "yes", label: "יש פרטי קשר" },
        { value: "no", label: "חסרים פרטי קשר" },
      ],
    },
  ];

  const filtered = hasActiveFilters(params);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">אנשי קשר</h2>
        <p className="page-sub">אנשי מפתח, רמת רלוונטיות וקישורי יצירת קשר.</p>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש שם, תפקיד, חברה או מיקום…"
        total={result.total}
      />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין אנשי קשר התואמים את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו חלק מהמסננים."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="עדיין אין אנשי קשר"
            hint="אנשי קשר נאספים מהחברות שנסרקו."
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
                    column="full_name"
                    label="שם"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="title"
                    label="תפקיד"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="company_name"
                    label="חברה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="relevance"
                    label="רלוונטיות"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>קישורים</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.full_name || "-"}</strong>
                      {p.location ? (
                        <div className="cell-muted">{p.location}</div>
                      ) : null}
                    </td>
                    <td className="cell-muted">
                      {p.title || "-"}
                      {p.seniority ? ` · ${p.seniority}` : ""}
                    </td>
                    <td className="cell-muted">{p.company_name || "-"}</td>
                    <td>
                      <span className={`badge ${relevanceClass(p.relevance)}`}>
                        {confidenceText(p.relevance)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {p.linkedin_url ? (
                          <a href={p.linkedin_url} target="_blank" rel="noreferrer">
                            LinkedIn
                          </a>
                        ) : null}
                        {p.email ? <a href={`mailto:${p.email}`}>Email</a> : null}
                        {p.phone ? <a href={`tel:${p.phone}`}>{p.phone}</a> : null}
                        {!p.linkedin_url && !p.email && !p.phone ? (
                          <span className="cell-muted">-</span>
                        ) : null}
                      </div>
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
            unit="אנשי קשר"
          />
        </>
      )}
    </div>
  );
}
