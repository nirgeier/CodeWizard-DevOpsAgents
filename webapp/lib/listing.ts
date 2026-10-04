// In-memory search / sort / slice.
//
// This is the engine behind local mode in lib/db.ts, and it is also what pages
// use when their rows cannot come from a single table - the companies view
// merges the database with the Comeet config before it can be filtered, so the
// narrowing has to happen after the merge rather than in Postgres.
//
// Pure and server/client agnostic by design: the same ordering rules then
// apply whichever backend produced the rows.

import type { Paged, PageQuery } from "./types";

export interface ListingSpec<T> {
  /** Fields scanned by the free-text box. Arrays are joined before matching. */
  search: (keyof T & string)[];
  /** sort key -> how to read it. Keys double as Postgres column names. */
  sorters: Record<string, (row: T) => string | number>;
  /** Applied when the chosen sort key ties; always descending. */
  tiebreak?: (row: T) => string | number;
}

export function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "he", { numeric: true });
}

/** Normalise for case- and accent-insensitive substring matching. */
export function fold(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFKD");
}

/**
 * Every whitespace-separated word must appear somewhere in the row.
 *
 * Matching per-word rather than per-phrase is what lets "acme devops" find a
 * row whose company is Acme and whose title mentions DevOps - two different
 * columns, one search box.
 */
export function matchesQuery<T>(row: T, fields: (keyof T & string)[], q: string): boolean {
  const needles = fold(q).trim().split(/\s+/).filter(Boolean);
  if (needles.length === 0) return true;
  const hay = fields
    .map((field) => {
      const value = (row as Record<string, unknown>)[field];
      return Array.isArray(value) ? value.map(fold).join(" ") : fold(value);
    })
    .join(" ");
  return needles.every((needle) => hay.includes(needle));
}

/**
 * Cut an already-filtered, already-sorted array down to one page.
 *
 * The page number is clamped rather than honoured literally: deep-linking to
 * `?page=99` after the data shrank should land on the last page, not on a
 * blank table with no way to tell what happened.
 */
export function sliceToPage<T>(items: T[], query: PageQuery): Paged<T> {
  const total = items.length;
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 200);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number(query.page) || 1, 1), totalPages);
  const from = (page - 1) * pageSize;
  return {
    items: items.slice(from, from + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * The full pipeline: narrow, search, sort, slice.
 *
 * Order is load-bearing. Filtering first is what makes `total` describe the
 * narrowed set, which is what the "26-50 of 312" readout promises; slicing
 * before sorting would page through an arbitrary order.
 */
export function applyListing<T>(
  rows: T[],
  spec: ListingSpec<T>,
  query: PageQuery,
  predicate?: (row: T) => boolean,
): Paged<T> {
  let items = predicate ? rows.filter(predicate) : rows;

  const q = (query.q ?? "").trim();
  if (q) items = items.filter((row) => matchesQuery(row, spec.search, q));

  const sorter = spec.sorters[query.sort ?? ""] ?? Object.values(spec.sorters)[0];
  if (sorter) {
    const sign = query.dir === "asc" ? 1 : -1;
    items = [...items].sort((a, b) => {
      const primary = compareValues(sorter(a), sorter(b)) * sign;
      if (primary !== 0 || !spec.tiebreak) return primary;
      return -compareValues(spec.tiebreak(a), spec.tiebreak(b));
    });
  }

  return sliceToPage(items, query);
}
