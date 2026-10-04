// The URL contract every list view speaks:
//
//   ?q=<search>&page=<n>&pageSize=<n>&sort=<col>&dir=asc|desc&<filter>=<value>
//
// Keeping it in one place is what lets the toolbar, the pagination control and
// the sortable headers be written once and dropped onto any page. The URL is
// the single source of truth for list state, so a filtered view is a shareable
// link and the browser Back button steps through filter changes.
//
// Imported by both server components (parsing) and client components
// (serialising), so this file must stay free of server-only imports.

export type SortDir = "asc" | "desc";

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Shape Next hands a page as `searchParams`. */
export type RawParams = Record<string, string | string[] | undefined>;

export interface ListParamsSpec {
  /** Columns a user may sort by. Anything else in the URL falls back to the default. */
  sortable: readonly string[];
  defaultSort: string;
  defaultDir?: SortDir;
  /** Named single-value filters this view understands (e.g. "status"). */
  filters?: readonly string[];
  defaultPageSize?: number;
}

export interface ListParams {
  q: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: SortDir;
  filters: Record<string, string>;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read list state out of a URL, clamping everything to something safe.
 *
 * Nothing here trusts the query string: an unknown sort column, a negative
 * page or a hand-typed pageSize all fall back to the view's defaults rather
 * than reaching the data layer.
 */
export function parseListParams(
  raw: RawParams,
  spec: ListParamsSpec,
): ListParams {
  const sizeRaw = Number(one(raw.pageSize));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : spec.defaultPageSize ?? DEFAULT_PAGE_SIZE;

  const pageRaw = Math.trunc(Number(one(raw.page)));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const sortRaw = one(raw.sort);
  const sort = spec.sortable.includes(sortRaw) ? sortRaw : spec.defaultSort;

  const dirRaw = one(raw.dir);
  const dir: SortDir =
    dirRaw === "asc" || dirRaw === "desc" ? dirRaw : spec.defaultDir ?? "desc";

  const filters: Record<string, string> = {};
  for (const key of spec.filters ?? []) {
    const value = one(raw[key]);
    if (value) filters[key] = value;
  }

  return { q: one(raw.q), page, pageSize, sort, dir, filters };
}

export interface ParamPatch {
  q?: string | null;
  page?: number | null;
  pageSize?: number | null;
  sort?: string | null;
  dir?: SortDir | null;
  /** `null` for a value clears that filter. */
  filters?: Record<string, string | null>;
}

/**
 * Serialise list state back into a href.
 *
 * Two deliberate behaviours:
 *   * Defaults are omitted, so the cleared view is a bare `/opportunities`
 *     rather than a URL carrying six redundant params.
 *   * Any change other than an explicit `page` resets to page 1 - landing on
 *     "page 7 of 2 results" after narrowing a filter is the classic bug here.
 */
export function listHref(
  basePath: string,
  params: ListParams,
  patch: ParamPatch = {},
  spec?: Pick<ListParamsSpec, "defaultSort" | "defaultDir" | "defaultPageSize">,
): string {
  const next: ListParams = {
    q: patch.q === undefined ? params.q : patch.q ?? "",
    page: patch.page ?? 1,
    pageSize: patch.pageSize ?? params.pageSize,
    sort: patch.sort === undefined ? params.sort : patch.sort ?? params.sort,
    dir: patch.dir === undefined ? params.dir : patch.dir ?? params.dir,
    filters: { ...params.filters },
  };

  for (const [key, value] of Object.entries(patch.filters ?? {})) {
    if (value == null || value === "") delete next.filters[key];
    else next.filters[key] = value;
  }

  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  for (const [key, value] of Object.entries(next.filters)) sp.set(key, value);
  if (spec?.defaultSort !== next.sort) sp.set("sort", next.sort);
  if ((spec?.defaultDir ?? "desc") !== next.dir) sp.set("dir", next.dir);
  if ((spec?.defaultPageSize ?? DEFAULT_PAGE_SIZE) !== next.pageSize) {
    sp.set("pageSize", String(next.pageSize));
  }
  if (next.page > 1) sp.set("page", String(next.page));

  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** True when the view is showing anything other than its default slice. */
export function hasActiveFilters(params: ListParams): boolean {
  return Boolean(params.q) || Object.keys(params.filters).length > 0;
}

/**
 * Page numbers to render, with `null` standing in for an ellipsis.
 * Always shows first, last, current and one neighbour either side, so the
 * control stays a fixed width whether there are 3 pages or 300.
 */
export function pageWindow(current: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | null)[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(totalPages - 1, current + 1);
  if (from > 2) out.push(null);
  for (let p = from; p <= to; p++) out.push(p);
  if (to < totalPages - 1) out.push(null);
  out.push(totalPages);
  return out;
}
