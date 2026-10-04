import { listCompanies } from "@/lib/db";
import { Chips } from "@/components/Badges";
import { formatDate } from "@/lib/format";
import { ScanButton } from "@/components/ScanButton";
<<<<<<< HEAD
=======
import { applyListing, type ListingSpec } from "@/lib/listing";
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
export const metadata = { title: "חברות" };

const BASE = "/companies";

const SPEC: ListParamsSpec = {
  sortable: ["score", "name", "devops_hiring_count", "last_seen_at", "source"],
  defaultSort: "score",
  defaultDir: "desc",
  filters: ["source", "hiring"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };
>>>>>>> origin/main

interface ComeetCompany {
  id: string;
  name: string;
  domain: string;
  uid: string;
  token?: string;
  discover_from?: string;
  source: "comeet";
}

<<<<<<< HEAD
=======
/** A database row, a Comeet config entry, or one reconciled from both. */
interface MergedCompany {
  id: string;
  name: string;
  domain: string;
  source: "database" | "comeet";
  inDatabase: boolean;
  hasComeet: boolean;
  comeet_uid?: string;
  comeet_token?: string;
  comeet_discover_from?: string;
  score: number;
  devops_hiring: boolean;
  devops_hiring_count: number;
  tech_stack: string[];
  last_seen_at: string | null;
  service: string;
  industry: string;
  hq_city: string;
  country: string;
}

>>>>>>> origin/main
async function getComeetCompanies(): Promise<ComeetCompany[]> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const WEBAPP_DIR = process.cwd();
<<<<<<< HEAD
  
  function firstExisting(candidates: string[], fallback: string): string {
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch {}
    }
    return fallback;
  }
  
  const CONFIG_DIR = firstExisting(
    [path.resolve(WEBAPP_DIR, "..", "agents", "config"), path.resolve(WEBAPP_DIR, "agents", "config")],
    path.resolve(WEBAPP_DIR, "..", "agents", "config"),
  );
  
  const COMEET_CONFIG = path.join(CONFIG_DIR, "comeet-companies.json");
  
  try {
    const data = JSON.parse(fs.readFileSync(COMEET_CONFIG, "utf8"));
    const companies = data.companies || [];
    return companies.map((c: any) => ({
      id: `comeet:${c.uid}`,
      name: c.name,
      domain: c.domain || "",
      uid: c.uid,
      token: c.token,
      discover_from: c.discover_from,
      source: "comeet" as const,
    }));
=======

  function firstExisting(candidates: string[], fallback: string): string {
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {
        // ignore
      }
    }
    return fallback;
  }

  const CONFIG_DIR = firstExisting(
    [
      path.resolve(WEBAPP_DIR, "..", "agents", "config"),
      path.resolve(WEBAPP_DIR, "agents", "config"),
    ],
    path.resolve(WEBAPP_DIR, "..", "agents", "config"),
  );

  const COMEET_CONFIG = path.join(CONFIG_DIR, "comeet-companies.json");

  try {
    const data = JSON.parse(fs.readFileSync(COMEET_CONFIG, "utf8"));
    const companies = data.companies || [];
    return companies.map(
      (c: Record<string, string>): ComeetCompany => ({
        id: `comeet:${c.uid}`,
        name: c.name,
        domain: c.domain || "",
        uid: c.uid,
        token: c.token,
        discover_from: c.discover_from,
        source: "comeet",
      }),
    );
>>>>>>> origin/main
  } catch {
    return [];
  }
}

<<<<<<< HEAD
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const [dbCompanies, comeetCompanies] = await Promise.all([
    listCompanies({ limit: 500 }),
    getComeetCompanies(),
  ]);

  // Merge companies, deduplicate by name+domain
  const mergedMap = new Map<string, any>();
  
  // First add DB companies
  for (const c of dbCompanies) {
    const key = `${c.name.toLowerCase()}|${(c.domain || "").toLowerCase()}`;
    mergedMap.set(key, { ...c, source: "database", inDatabase: true });
  }
  
  // Then add/merge Comeet companies
=======
/**
 * The listing spec for the merged set.
 *
 * Companies are the one view whose rows do not come from a single table: the
 * database and the Comeet config are reconciled first, so searching, sorting
 * and paging all run over the merged array rather than in Postgres.
 */
const MERGED_SPEC: ListingSpec<MergedCompany> = {
  search: ["name", "domain", "service", "industry", "hq_city", "country"],
  sorters: {
    score: (c) => c.score,
    name: (c) => c.name,
    devops_hiring_count: (c) => c.devops_hiring_count,
    last_seen_at: (c) => c.last_seen_at ?? "",
    source: (c) => c.source,
  },
  tiebreak: (c) => c.name,
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = parseListParams(await searchParams, SPEC);

  const [dbCompanies, comeetCompanies] = await Promise.all([
    listCompanies({ limit: 5000 }),
    getComeetCompanies(),
  ]);

  // Reconcile on name+domain. A company present in both is one row carrying
  // its database score and its Comeet credentials, not two near-duplicates.
  const mergedMap = new Map<string, MergedCompany>();

  for (const c of dbCompanies) {
    const key = `${c.name.toLowerCase()}|${(c.domain || "").toLowerCase()}`;
    mergedMap.set(key, {
      id: c.id,
      name: c.name,
      domain: c.domain || "",
      source: "database",
      inDatabase: true,
      hasComeet: false,
      score: Number(c.score ?? 0) || 0,
      devops_hiring: Boolean(c.devops_hiring),
      devops_hiring_count: Number(c.devops_hiring_count ?? 0) || 0,
      tech_stack: Array.isArray(c.tech_stack) ? c.tech_stack : [],
      last_seen_at: c.last_seen_at ?? null,
      service: c.service || "",
      industry: c.industry || "",
      hq_city: c.hq_city || "",
      country: c.country || "",
    });
  }

>>>>>>> origin/main
  for (const c of comeetCompanies) {
    const key = `${c.name.toLowerCase()}|${(c.domain || "").toLowerCase()}`;
    const existing = mergedMap.get(key);
    if (existing) {
<<<<<<< HEAD
      // Merge: add Comeet info to existing DB company
=======
>>>>>>> origin/main
      mergedMap.set(key, {
        ...existing,
        comeet_uid: c.uid,
        comeet_token: c.token,
        comeet_discover_from: c.discover_from,
        hasComeet: true,
      });
    } else {
<<<<<<< HEAD
      // New company only in Comeet
=======
>>>>>>> origin/main
      mergedMap.set(key, {
        id: c.id,
        name: c.name,
        domain: c.domain,
        source: "comeet",
        inDatabase: false,
        hasComeet: true,
        comeet_uid: c.uid,
        comeet_token: c.token,
        comeet_discover_from: c.discover_from,
        score: 0,
<<<<<<< HEAD
        devops_hiring_count: 0,
        devops_hiring: false,
        tech_stack: [],
        last_seen_at: null,
        service: "Comeet",
=======
        devops_hiring: false,
        devops_hiring_count: 0,
        tech_stack: [],
        last_seen_at: null,
        service: "Comeet",
        industry: "",
        hq_city: "",
        country: "",
>>>>>>> origin/main
      });
    }
  }

<<<<<<< HEAD
  const mergedCompanies = Array.from(mergedMap.values()).sort((a, b) => 
    (b.score ?? 0) - (a.score ?? 0)
  );

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">חברות</h2>
        <p className="page-sub">
          פרופילי חברות ממסד הנתונים ומקורות חיצוניים (Comeet). לחץ "סרוק" לעדכון משרות.
        </p>
      </div>

      {mergedCompanies.length === 0 ? (
        <div className="empty">לא נמצאו חברות.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>חברה</th>
                <th>מקור</th>
                <th>שירות</th>
                <th>Score</th>
                <th>משרות DevOps</th>
                <th>Tech Stack</th>
                <th>נראה לאחרונה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {mergedCompanies.map((c) => (
                <tr key={c.id || `comeet-${c.comeet_uid}`}>
                  <td>
                    <strong>{c.name || "-"}</strong>
                    {c.domain ? (
                      <div className="cell-muted">{c.domain}</div>
                    ) : null}
                    {c.comeet_uid && (
                      <div className="cell-muted" style={{ fontSize: "11px", fontFamily: "monospace" }}>
                        Comeet UID: {c.comeet_uid}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${c.source === "database" ? "conf-blue" : c.source === "comeet" ? "conf-purple" : "conf-grey"}`}>
                      {c.source === "database" ? "מסד נתונים" : c.source === "comeet" ? "Comeet" : c.source}
                    </span>
                    {c.hasComeet && c.source === "database" && (
                      <span className="badge conf-purple" style={{ marginRight: 6 }}>Comeet</span>
                    )}
                  </td>
                  <td className="cell-muted">{c.service || "-"}</td>
                  <td>
                    <span className="badge conf-blue">{c.score ?? 0}</span>
                  </td>
                  <td className="cell-muted">
                    {c.devops_hiring_count ?? 0}
                    {c.devops_hiring ? " · מגייסת" : ""}
                  </td>
                  <td>
                    <Chips items={c.tech_stack} />
                  </td>
                  <td className="cell-muted nowrap">
                    {formatDate(c.last_seen_at)}
                  </td>
                  <td>
                    <div className="actions-cell">
                      {c.hasComeet && c.comeet_uid && (
                        <ScanButton 
                          sourceId={`comeet:${c.comeet_uid}`} 
                          companyName={c.name}
                          disabled={!c.comeet_uid}
                        />
                      )}
                      {c.inDatabase && !c.hasComeet && (
                        <button className="btn btn-secondary" disabled style={{ fontSize: "12px", padding: "4px 10px" }}>
                          הוסף Comeet
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
=======
  const merged = [...mergedMap.values()];

  const sourceFilter = params.filters.source ?? "";
  const hiringFilter = params.filters.hiring ?? "";

  const result = applyListing(merged, MERGED_SPEC, params, (c) => {
    if (sourceFilter === "database" && !c.inDatabase) return false;
    if (sourceFilter === "comeet" && !c.hasComeet) return false;
    if (sourceFilter === "both" && !(c.inDatabase && c.hasComeet)) return false;
    if (hiringFilter === "yes" && !c.devops_hiring) return false;
    if (hiringFilter === "no" && c.devops_hiring) return false;
    return true;
  });

  const filters: FilterSpec[] = [
    {
      key: "source",
      label: "מקור",
      options: [
        {
          value: "database",
          label: "מסד נתונים",
          count: merged.filter((c) => c.inDatabase).length,
        },
        {
          value: "comeet",
          label: "Comeet",
          count: merged.filter((c) => c.hasComeet).length,
        },
        {
          value: "both",
          label: "שניהם",
          count: merged.filter((c) => c.inDatabase && c.hasComeet).length,
        },
      ],
    },
    {
      key: "hiring",
      label: "גיוס DevOps",
      options: [
        {
          value: "yes",
          label: "מגייסת",
          count: merged.filter((c) => c.devops_hiring).length,
        },
        {
          value: "no",
          label: "לא מגייסת",
          count: merged.filter((c) => !c.devops_hiring).length,
        },
      ],
    },
  ];

  const filtered = hasActiveFilters(params);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">חברות</h2>
        <p className="page-sub">
          פרופילי חברות ממסד הנתונים וממקורות חיצוניים (Comeet). לחצו ״סרוק״
          לעדכון משרות.
        </p>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש שם חברה, דומיין או תחום…"
        total={result.total}
      />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין חברות התואמות את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו חלק מהמסננים."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="עדיין אין חברות"
            hint="חברות נאספות מסריקות ומקובץ ההגדרות של Comeet."
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
                    column="name"
                    label="חברה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <SortHeader
                    column="source"
                    label="מקור"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                    firstClick="asc"
                  />
                  <th>שירות</th>
                  <SortHeader
                    column="score"
                    label="Score"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <SortHeader
                    column="devops_hiring_count"
                    label="משרות DevOps"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>Tech Stack</th>
                  <SortHeader
                    column="last_seen_at"
                    label="נראה לאחרונה"
                    basePath={BASE}
                    params={params}
                    defaults={DEFAULTS}
                  />
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((c) => (
                  <tr key={c.id || `comeet-${c.comeet_uid}`}>
                    <td>
                      <strong>{c.name || "-"}</strong>
                      {c.domain ? <div className="cell-muted">{c.domain}</div> : null}
                      {c.comeet_uid ? (
                        <div className="cell-uid">Comeet UID: {c.comeet_uid}</div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          c.source === "database" ? "conf-blue" : "conf-purple"
                        }`}
                      >
                        {c.source === "database" ? "מסד נתונים" : "Comeet"}
                      </span>
                      {c.hasComeet && c.source === "database" ? (
                        <span className="badge conf-purple" style={{ marginRight: 6 }}>
                          Comeet
                        </span>
                      ) : null}
                    </td>
                    <td className="cell-muted">{c.service || "-"}</td>
                    <td>
                      <span className="badge conf-blue">{c.score}</span>
                    </td>
                    <td className="cell-muted">
                      {c.devops_hiring_count}
                      {c.devops_hiring ? " · מגייסת" : ""}
                    </td>
                    <td>
                      <Chips items={c.tech_stack} />
                    </td>
                    <td className="cell-muted nowrap">{formatDate(c.last_seen_at)}</td>
                    <td>
                      <div className="actions-cell">
                        {c.hasComeet && c.comeet_uid ? (
                          <ScanButton
                            sourceId={`comeet:${c.comeet_uid}`}
                            companyName={c.name}
                          />
                        ) : null}
                        {c.inDatabase && !c.hasComeet ? (
                          <button className="btn btn-secondary btn-sm" disabled>
                            הוסף Comeet
                          </button>
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
            unit="חברות"
          />
        </>
      )}
    </div>
  );
}
>>>>>>> origin/main
