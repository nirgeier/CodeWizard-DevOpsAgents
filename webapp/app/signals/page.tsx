import { listSignals } from "@/lib/db";
import { TypeBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const type = sp.type || "";
  const items = await listSignals({ type: type || null, limit: 500 });

  const types = Array.from(
    new Set(
      (await listSignals({ limit: 500 }))
        .map((s) => s.type)
        .filter((t): t is string => Boolean(t)),
    ),
  ).sort();

  return (
    <div>
      <h2 className="page-title">איתותים</h2>
      <p className="page-sub">איתותי שוק, גיוסים ואירועים המזינים את ההזדמנויות.</p>

      <form className="filters" method="get">
        <div className="field">
          <label htmlFor="type">סוג איתות</label>
          <select id="type" name="type" defaultValue={type}>
            <option value="">הכל</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          סנן
        </button>
      </form>

      {items.length === 0 ? (
        <div className="empty">לא נמצאו איתותים.</div>
      ) : (
        <div className="stack">
          {items.map((sig) => (
            <article className="card" key={sig.id}>
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
      )}
    </div>
  );
}
