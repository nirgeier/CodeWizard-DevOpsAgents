import Link from "next/link";
import { getStats, listOpportunities } from "@/lib/db";
import { ConfidenceBadge, StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const KPIS = [
  { key: "opportunities", label: "הזדמנויות" },
  { key: "qualified", label: "מוסמכות ≥0.70" },
  { key: "review", label: "לבדיקה" },
  { key: "signals", label: "איתותים" },
  { key: "companies", label: "חברות" },
  { key: "people", label: "אנשי קשר" },
] as const;

export default async function DashboardPage() {
  const [stats, top] = await Promise.all([
    getStats(),
    listOpportunities({ limit: 5 }),
  ]);

  return (
    <div>
      <h2 className="page-title">לוח בקרה</h2>
      <p className="page-sub">
        סקירה כללית של צבר ההזדמנויות והאיתותים של CodeWizard.
      </p>

      <div className="grid cols-6">
        {KPIS.map((kpi) => (
          <div className="card kpi" key={kpi.key}>
            <div className="value">{stats[kpi.key]}</div>
            <div className="label">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row-between">
          <div>
            <strong>סריקה אחרונה</strong>
          </div>
          <div className="cell-muted">{formatDateTime(stats.lastScan)}</div>
        </div>
      </div>

      <h3 className="section-title">חמש ההזדמנויות המובילות (לפי confidence)</h3>

      {top.length === 0 ? (
        <div className="empty">
          אין הזדמנויות להצגה. הריצו סריקה או חברו מקור נתונים.
        </div>
      ) : (
        <div className="stack">
          {top.map((opp) => (
            <Link
              key={opp.id}
              href={`/opportunities/${opp.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <article className="card">
                <div className="opp-header">
                  <div>
                    <h2>{opp.company_name || "-"}</h2>
                    <div className="opp-meta">
                      {opp.target_person_name || "-"}
                      {opp.target_title ? ` · ${opp.target_title}` : ""}
                      {opp.persona ? ` · ${opp.persona}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <ConfidenceBadge value={opp.confidence} />
                    <StatusBadge status={opp.status} />
                  </div>
                </div>
                <div className="detail-section">
                  <div className="label">Why Now</div>
                  <p className="body">{opp.why_now || "-"}</p>
                </div>
                {opp.location ? (
                  <div className="cell-muted" style={{ marginTop: 8 }}>
                    מיקום: {opp.location}
                  </div>
                ) : null}
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
