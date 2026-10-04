import {
  confidenceClass,
  confidenceText,
  statusClass,
} from "@/lib/format";

export function ConfidenceBadge({ value }: { value: unknown }) {
  return (
    <span className={`badge ${confidenceClass(value)}`}>
      {confidenceText(value)}
    </span>
  );
}

export function StatusBadge({ status }: { status: unknown }) {
  const label = typeof status === "string" && status ? status : "new";
  return <span className={`badge ${statusClass(status)}`}>{label}</span>;
}

export function TypeBadge({ type }: { type: unknown }) {
  const label = typeof type === "string" && type ? type : "signal";
  return <span className="badge type">{label}</span>;
}

export function Chips({ items }: { items?: unknown[] | null }) {
  if (!items || items.length === 0) return <span className="cell-muted">-</span>;
  return (
    <div className="chips">
      {items.map((item, i) => (
        <span className="chip" key={i}>
          {typeof item === "string" ? item : JSON.stringify(item)}
        </span>
      ))}
    </div>
  );
}
