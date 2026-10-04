// Presentation helpers shared by server and client components.

export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function confidenceClass(value: unknown): string {
  const v = toNumber(value);
  if (v >= 0.8) return "conf-green";
  if (v >= 0.7) return "conf-blue";
  if (v >= 0.65) return "conf-amber";
  return "conf-grey";
}

export function confidenceText(value: unknown): string {
  const v = toNumber(value);
  return v.toFixed(2);
}

export function statusClass(status: unknown): string {
  const s = typeof status === "string" && status ? status : "new";
  const known = [
    "new",
    "review",
    "approved",
    "rejected",
    "contacted",
    "meeting",
    "lost",
    "archived",
  ];
  return `status-${known.includes(s) ? s : "new"}`;
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
