"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listHref, type ListParams, type ParamPatch } from "@/lib/query";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterSpec {
  key: string;
  label: string;
  options: FilterOption[];
  /** Text for the "no filter" choice. Defaults to "הכל". */
  allLabel?: string;
}

interface Props {
  basePath: string;
  params: ListParams;
  defaults: { defaultSort: string; defaultDir?: "asc" | "desc"; defaultPageSize?: number };
  filters?: FilterSpec[];
  searchPlaceholder?: string;
  /** Rows matching the current filters, across all pages. */
  total: number;
  /** Rendered next to the controls - a scan button, an export link, etc. */
  children?: React.ReactNode;
}

const ALL = "";

/**
 * Search + filter bar for a list view.
 *
 * Behaves the way a desktop app does rather than like a form: dropdowns apply
 * the moment they change and the search box applies as you stop typing, so
 * there is no "Apply" button to forget to press. State lives entirely in the
 * URL, which keeps a filtered view shareable and the Back button meaningful.
 */
export default function DataToolbar({
  basePath,
  params,
  defaults,
  filters = [],
  searchPlaceholder = "חיפוש…",
  total,
  children,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // The input leads the URL while the user types, so it cannot simply mirror
  // `params.q`. `sentRef` records the query this component last pushed; a
  // `params.q` matching it is just the server echoing our own navigation and
  // must not touch the box - otherwise a slow response for "abc" arriving
  // after the user has reached "abcd" would rewind their typing. Anything else
  // is an outside change (Back, a cleared filter, a pasted link) and wins.
  const [draft, setDraft] = useState(params.q);
  const sentRef = useRef(params.q);
  useEffect(() => {
    if (params.q === sentRef.current) return;
    sentRef.current = params.q;
    setDraft(params.q);
  }, [params.q]);

  // Dropdowns answer instantly even though the real update is a server round
  // trip, so the control never visibly snaps back to its old value.
  const [shownFilters, applyFilter] = useOptimistic(
    params.filters,
    (state, patch: { key: string; value: string }) => {
      const next = { ...state };
      if (patch.value) next[patch.key] = patch.value;
      else delete next[patch.key];
      return next;
    },
  );

  /**
   * `optimistic` runs inside the same transition as the navigation - React
   * rejects a useOptimistic update made outside one, and pairing them here is
   * also what makes the dropdown hold its new value until the server answers.
   */
  function navigate(patch: ParamPatch, opts: { replace?: boolean; optimistic?: () => void } = {}) {
    if (patch.q !== undefined) sentRef.current = patch.q ?? "";
    const href = listHref(basePath, params, patch, defaults);
    startTransition(() => {
      opts.optimistic?.();
      if (opts.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  // Debounce the search box. `replace` rather than `push` so a five-letter
  // query leaves one history entry instead of five.
  useEffect(() => {
    if (draft === params.q) return;
    const timer = setTimeout(() => navigate({ q: draft }, { replace: true }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // "/" focuses search the way it does in every tool this sits beside.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeChips = [
    ...(params.q ? [{ key: "q", label: "חיפוש", value: params.q, display: params.q }] : []),
    ...filters.flatMap((filter) => {
      const value = params.filters[filter.key];
      if (!value) return [];
      const option = filter.options.find((o) => o.value === value);
      return [
        {
          key: filter.key,
          label: filter.label,
          value,
          display: option?.label ?? value,
        },
      ];
    }),
  ];

  return (
    <div className={`toolbar${isPending ? " is-pending" : ""}`}>
      <div className="toolbar-row">
        <div className="toolbar-search">
          <span className="toolbar-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={searchRef}
            className="input"
            type="search"
            value={draft}
            placeholder={searchPlaceholder}
            aria-label="חיפוש"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft("");
              if (e.key === "Enter") navigate({ q: draft }, { replace: true });
            }}
          />
          {draft ? (
            <button
              type="button"
              className="toolbar-search-clear"
              aria-label="נקה חיפוש"
              onClick={() => {
                setDraft("");
                searchRef.current?.focus();
              }}
            >
              ×
            </button>
          ) : null}
        </div>

        {filters.map((filter) => (
          <label className="toolbar-field" key={filter.key}>
            <span>{filter.label}</span>
            <select
              value={shownFilters[filter.key] ?? ALL}
              onChange={(e) => {
                const value = e.target.value;
                navigate(
                  { filters: { [filter.key]: value || null } },
                  { optimistic: () => applyFilter({ key: filter.key, value }) },
                );
              }}
            >
              <option value={ALL}>{filter.allLabel ?? "הכל"}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.count != null ? ` (${option.count})` : ""}
                </option>
              ))}
            </select>
          </label>
        ))}

        <div className="toolbar-spacer" />
        {children}
      </div>

      {activeChips.length > 0 ? (
        <div className="toolbar-chips">
          <span className="toolbar-count">
            {total.toLocaleString("he-IL")} תוצאות
          </span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="filter-chip"
              onClick={() =>
                chip.key === "q"
                  ? (setDraft(""), navigate({ q: "" }))
                  : navigate({ filters: { [chip.key]: null } })
              }
            >
              <span className="filter-chip-label">{chip.label}:</span>
              <span className="filter-chip-value">{chip.display}</span>
              <span className="filter-chip-x" aria-hidden="true">
                ×
              </span>
              <span className="sr-only">הסר סינון</span>
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDraft("");
              navigate({
                q: "",
                filters: Object.fromEntries(filters.map((f) => [f.key, null])),
              });
            }}
          >
            נקה הכל
          </button>
        </div>
      ) : (
        <div className="toolbar-chips">
          <span className="toolbar-count">
            {total.toLocaleString("he-IL")} תוצאות
          </span>
        </div>
      )}
    </div>
  );
}
