import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpportunity } from "@/lib/db";
import { ConfidenceBadge, StatusBadge } from "@/components/Badges";
import { formatDateTime } from "@/lib/format";
import OpportunityActions from "@/components/OpportunityActions";
import type { OpportunityEvidence, OpportunitySignal } from "@/lib/types";

export const dynamic = "force-dynamic";

function Section({ label, body }: { label: string; body?: string | null }) {
  return (
    <div className="detail-section">
      <div className="label">{label}</div>
      <p className="body">{body && body.trim() ? body : "-"}</p>
    </div>
  );
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opp = await getOpportunity(id);
  if (!opp) notFound();

  const evidence: OpportunityEvidence[] = Array.isArray(opp.evidence)
    ? opp.evidence
    : [];
  const signals: OpportunitySignal[] = Array.isArray(opp.signals)
    ? opp.signals
    : [];

  const who = [
    opp.target_person_name || "-",
    opp.target_title ? `· ${opp.target_title}` : "",
    opp.persona ? `· ${opp.persona}` : "",
    opp.location ? `· ${opp.location}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <p className="page-sub" style={{ marginBottom: 10 }}>
        <Link href="/opportunities">← חזרה לכל ההזדמנויות</Link>
      </p>

      <article className="card">
        <div className="opp-header">
          <div>
            <h2>{opp.company_name || "-"}</h2>
            <div className="opp-meta">
              {opp.domain ? (
                <a
                  href={`https://${opp.domain}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {opp.domain}
                </a>
              ) : (
                "-"
              )}
              {opp.linkedin_url ? (
                <>
                  {" · "}
                  <a
                    href={opp.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn
                  </a>
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ConfidenceBadge value={opp.confidence} />
            <StatusBadge status={opp.status} />
          </div>
        </div>

        <Section label="WHO" body={who} />
        <Section label="WHAT" body={opp.what_is_happening} />
        <Section label="WHY NOW" body={opp.why_now} />
        <Section label="PAIN" body={opp.potential_pain} />
        <Section label="CONTEXT" body={opp.context} />
        <Section label="APPROACH" body={opp.recommended_approach} />
        <Section label="QUESTION" body={opp.opening_question} />

        {opp.tags && opp.tags.length > 0 ? (
          <div className="detail-section">
            <div className="label">TAGS</div>
            <div className="chips">
              {opp.tags.map((t, i) => (
                <span className="chip" key={i}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="detail-section">
          <div className="label">EVIDENCE</div>
          {evidence.length === 0 ? (
            <p className="body">-</p>
          ) : (
            <ul className="evidence-list">
              {evidence.map((ev, i) => (
                <li key={i}>
                  <div className="ev-label">
                    {ev.url ? (
                      <a href={ev.url} target="_blank" rel="noreferrer">
                        {ev.label || ev.url}
                      </a>
                    ) : (
                      ev.label || "-"
                    )}
                  </div>
                  {ev.quote ? (
                    <div className="ev-quote">״{ev.quote}״</div>
                  ) : null}
                  {ev.source ? (
                    <div className="ev-source">מקור: {ev.source}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="detail-section">
          <div className="label">SIGNALS</div>
          {signals.length === 0 ? (
            <p className="body">-</p>
          ) : (
            <div className="chips">
              {signals.map((s, i) => (
                <span className="chip" key={i}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      [{s.type || "signal"}] {s.headline || s.company_name || "-"}
                    </a>
                  ) : (
                    <>
                      [{s.type || "signal"}]{" "}
                      {s.headline || s.company_name || "-"}
                    </>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {opp.owner_notes ? (
          <Section label="OWNER NOTES" body={opp.owner_notes} />
        ) : null}
        {opp.next_action ? (
          <Section label="NEXT ACTION" body={opp.next_action} />
        ) : null}

        <div className="cell-muted" style={{ marginTop: 16, fontSize: 12.5 }}>
          עודכן: {formatDateTime(opp.updated_at)} · נוצר:{" "}
          {formatDateTime(opp.created_at)}
        </div>

        <OpportunityActions id={opp.id} status={opp.status} />
      </article>
    </div>
  );
}
