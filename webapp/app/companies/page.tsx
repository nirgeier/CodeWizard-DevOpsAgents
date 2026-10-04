import { listCompanies } from "@/lib/db";
import { Chips } from "@/components/Badges";
import { formatDate } from "@/lib/format";
import { ScanButton } from "@/components/ScanButton";
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
  sortable: [
    "hiring",
    "score",
    "name",
    "devops_hiring_count",
    "open_roles_israel",
    "industry",
    "last_seen_at",
    "source",
  ],
  // The directory is the point of this view: most rows carry no score, so
  // score-desc would bury them all under the handful the scanner has seen.
  // Lead with who is hiring instead.
  defaultSort: "hiring",
  defaultDir: "desc",
  filters: ["source", "hiring"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

interface ComeetCompany {
  id: string;
  name: string;
  domain: string;
  uid: string;
  token?: string;
  discover_from?: string;
  source: "comeet";
}

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
  open_roles_israel: number;
  ats_providers: string[];
}

async function getComeetCompanies(): Promise<ComeetCompany[]> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const WEBAPP_DIR = process.cwd();
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
  } catch {
    return [];
  }
}

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
    // One scalar so it can go through compareValues: companies hiring now beat
    // those that are not, then more DevOps roles, then a wider open-role count.
    hiring: (c) =>
      (c.devops_hiring ? 1_000_000 : 0) +
      (c.devops_hiring_count ?? 0) * 1000 +
      Math.min(c.open_roles_israel ?? 0, 999),
    score: (c) => c.score,
    name: (c) => c.name,
    devops_hiring_count: (c) => c.devops_hiring_count,
    open_roles_israel: (c) => c.open_roles_israel,
    industry: (c) => c.industry,
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
      open_roles_israel: Number(c.open_roles_israel ?? 0) || 0,
      ats_providers: Array.isArray(c.ats?.providers)
        ? c.ats!.providers!.filter(Boolean)
        : [],
    });
  }

  for (const c of comeetCompanies) {
    const key = `${c.name.toLowerCase()}|${(c.domain || "").toLowerCase()}`;
    const existing = mergedMap.get(key);
    if (existing) {
      // Merge: add Comeet info to existing DB company
      mergedMap.set(key, {
        ...existing,
        comeet_uid: c.uid,
        comeet_token: c.token,
        comeet_discover_from: c.discover_from,
        hasComeet: true,
      });
    } else {
      // New company only in Comeet
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
        devops_hiring_count: 0,
        devops_hiring: false,
        tech_stack: [],
        last_seen_at: null,
        service: "Comeet",
        industry: "",
        hq_city: "",
        country: "",
        open_roles_israel: 0,
        ats_providers: [],
      });
    }
  }

  const mergedCompanies = Array.from(mergedMap.values());

  // This view merges two sources in memory, so the filters `facet()` would
  // normally run in the database are applied here instead.
  const result = applyListing(
    mergedCompanies,
    MERGED_SPEC,
    params,
    (c) => {
      const { source, hiring } = params.filters;
      if (source && c.source !== source) return false;
      if (hiring === "yes" && !c.devops_hiring) return false;
      if (hiring === "no" && c.devops_hiring) return false;
      return true;
    },
  );

  const countBy = (pick: (c: MergedCompany) => string) => {
    const counts = new Map<string, number>();
    for (const c of mergedCompanies) {
      const key = pick(c);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "he"));
  };

  const filters: FilterSpec[] = [
    {
      key: "source",
      label: "מקור",
      options: countBy((c) => c.source).map((o) => ({
        value: o.value,
        label: o.value === "database" ? "מסד נתונים" : "Comeet",
        count: o.count,
      })),
    },
    {
      key: "hiring",
      label: "מגייסת DevOps",
      options: [
        { value: "yes", label: "כן", count: mergedCompanies.filter((c) => c.devops_hiring).length },
        { value: "no", label: "לא", count: mergedCompanies.filter((c) => !c.devops_hiring).length },
      ],
    },
  ];

  const filtered = hasActiveFilters(params);

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">חברות</h2>
        <p className="page-sub">
          פרופילי חברות ממסד הנתונים ומקורות חיצוניים (Comeet). לחץ "סרוק" לעדכון משרות.
        </p>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={filters}
        searchPlaceholder="חיפוש חברה, תחום או מדינה…"
        total={result.total}
      />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title="אין חברות התואמות את הסינון"
            hint="נסו מונח חיפוש רחב יותר, או הסירו את המסנן."
            action={{ href: BASE, label: "נקה סינון" }}
          />
        ) : (
          <EmptyState
            title="לא נמצאו חברות"
            hint="הריצו סריקה, או ייבאו את מדריך המעסיקים."
          />
        )
      ) : (
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
                  column="industry"
                  label="תחום"
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
                <SortHeader
                  column="score"
                  label="Score"
                  basePath={BASE}
                  params={params}
                  defaults={DEFAULTS}
                />
                <SortHeader
                  column="hiring"
                  label="DevOps"
                  basePath={BASE}
                  params={params}
                  defaults={DEFAULTS}
                />
                <SortHeader
                  column="open_roles_israel"
                  label="משרות פתוחות"
                  basePath={BASE}
                  params={params}
                  defaults={DEFAULTS}
                  align="end"
                />
                <th>ATS</th>
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
                    {c.domain ? (
                      <div className="cell-muted">{c.domain}</div>
                    ) : null}
                    {c.comeet_uid && (
                      <div className="cell-muted" style={{ fontSize: "11px", fontFamily: "monospace" }}>
                        Comeet UID: {c.comeet_uid}
                      </div>
                    )}
                  </td>
                  <td className="cell-muted">
                    {c.industry || "-"}
                    {c.country ? (
                      <div className="cell-muted" style={{ fontSize: "11px" }}>
                        {c.country}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${c.source === "database" ? "conf-blue" : c.source === "comeet" ? "conf-purple" : "conf-grey"}`}>
                      {c.source === "database" ? "מסד נתונים" : c.source === "comeet" ? "Comeet" : c.source}
                    </span>
                    {c.hasComeet && c.source === "database" && (
                      <span className="badge conf-purple" style={{ marginRight: 6 }}>Comeet</span>
                    )}
                  </td>
                  <td>
                    <span className="badge conf-blue">{c.score ?? 0}</span>
                  </td>
                  <td className="cell-muted">
                    {c.devops_hiring_count ?? 0}
                    {c.devops_hiring ? " · מגייסת" : ""}
                  </td>
                  <td className="cell-muted" style={{ textAlign: "end" }}>
                    {c.open_roles_israel > 0 ? c.open_roles_israel : "-"}
                  </td>
                  <td>
                    {c.ats_providers.length > 0 ? (
                      <Chips items={c.ats_providers} />
                    ) : (
                      <span className="cell-muted">-</span>
                    )}
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