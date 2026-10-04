import Link from "next/link";
import { listHref, type ListParams } from "@/lib/query";

interface Props {
  /** Must match a key in the entity's `sorters` map in lib/db.ts. */
  column: string;
  label: string;
  basePath: string;
  params: ListParams;
  defaults: { defaultSort: string; defaultDir?: "asc" | "desc"; defaultPageSize?: number };
  /** Text columns read better ascending on first click; scores do not. */
  firstClick?: "asc" | "desc";
  align?: "start" | "end";
}

/**
 * A sortable `<th>`.
 *
 * Server-rendered as a plain link, so sorting survives with JS disabled and
 * each sort order is its own URL. Clicking the active column flips direction;
 * clicking a new one starts at that column's natural direction - ascending for
 * names, descending for scores and dates, which is what people expect without
 * being told.
 */
export default function SortHeader({
  column,
  label,
  basePath,
  params,
  defaults,
  firstClick = "desc",
  align = "start",
}: Props) {
  const active = params.sort === column;
  const nextDir = active ? (params.dir === "asc" ? "desc" : "asc") : firstClick;
  const href = listHref(basePath, params, { sort: column, dir: nextDir }, defaults);

  return (
    <th className={`th-sort${active ? " is-active" : ""} th-${align}`} aria-sort={
      active ? (params.dir === "asc" ? "ascending" : "descending") : "none"
    }>
      <Link href={href} scroll={false}>
        <span>{label}</span>
        <span className="th-sort-arrow" aria-hidden="true">
          {active ? (params.dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </Link>
    </th>
  );
}
