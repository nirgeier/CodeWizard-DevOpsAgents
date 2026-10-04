import { listCompanies } from "@/lib/db";
import { Chips } from "@/components/Badges";
import { formatDate } from "@/lib/format";
import { ScanButton } from "@/components/ScanButton";

interface ComeetCompany {
  id: string;
  name: string;
  domain: string;
  uid: string;
  token?: string;
  discover_from?: string;
  source: "comeet";
}

async function getComeetCompanies(): Promise<ComeetCompany[]> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const WEBAPP_DIR = process.cwd();
  
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
  } catch {
    return [];
  }
}

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
      });
    }
  }

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