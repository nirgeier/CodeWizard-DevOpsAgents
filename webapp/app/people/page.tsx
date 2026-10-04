import { listPeople } from "@/lib/db";
import { confidenceText, toNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

function relevanceClass(value: unknown): string {
  const v = toNumber(value);
  if (v >= 0.8) return "conf-green";
  if (v >= 0.7) return "conf-blue";
  if (v >= 0.65) return "conf-amber";
  return "conf-grey";
}

export default async function PeoplePage() {
  const items = await listPeople({ limit: 500 });

  return (
    <div>
      <h2 className="page-title">אנשי קשר</h2>
      <p className="page-sub">אנשי מפתח, רמת רלוונטיות וקישורי יצירת קשר.</p>

      {items.length === 0 ? (
        <div className="empty">לא נמצאו אנשי קשר.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>תפקיד</th>
                <th>חברה</th>
                <th>רלוונטיות</th>
                <th>קישורים</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
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
                        <a
                          href={p.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          LinkedIn
                        </a>
                      ) : null}
                      {p.email ? <a href={`mailto:${p.email}`}>Email</a> : null}
                      {p.phone ? (
                        <a href={`tel:${p.phone}`}>{p.phone}</a>
                      ) : null}
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
      )}
    </div>
  );
}
