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
  "lost",
  "archived",
];

const CONFIDENCE_OPTIONS = [
  { value: "", label: "הכל" },
  { value: "0.80", label: "≥ 0.80" },
  { value: "0.70", label: "≥ 0.70" },
  { value: "0.65", label: "≥ 0.65" },
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
      )}
    </div>
  );
}
