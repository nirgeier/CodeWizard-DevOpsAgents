import Link from "next/link";

/**
 * The "nothing here" panel.
 *
 * Deliberately distinguishes two very different situations: a table that is
 * empty because nothing has been scanned yet (tell them how to start) and one
 * that is empty because the filters are too narrow (offer to widen them). The
 * generic "no results" message that covers both leaves a user stuck.
 */
export default function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        ⌕
      </div>
      <div className="empty-state-title">{title}</div>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
      {action ? (
        <Link className="btn btn-primary" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
