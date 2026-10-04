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
      )}
    </div>
  );
}
