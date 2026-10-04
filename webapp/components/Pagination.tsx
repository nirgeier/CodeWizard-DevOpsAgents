"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  listHref,
  pageWindow,
  PAGE_SIZES,
  type ListParams,
} from "@/lib/query";

interface Props {
  basePath: string;
  params: ListParams;
  defaults: { defaultSort: string; defaultDir?: "asc" | "desc"; defaultPageSize?: number };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Plural noun for the range readout, e.g. "הזדמנויות". */
  unit?: string;
}

/**
 * Page navigation for a list view.
 *
 * The page numbers are real `<Link>`s, not buttons: they prefetch on hover and
 * open in a new tab on middle-click, which is what makes a long table feel
 * like a document rather than an app widget. Only the page-size control needs
 * JavaScript, because a `<select>` has no href.
 */
export default function Pagination({
  basePath,
  params,
  defaults,
  page,
  pageSize,
  total,
  totalPages,
  unit = "רשומות",
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const href = (p: number) => listHref(basePath, params, { page: p }, defaults);

  return (
    <nav
      className={`pagination${isPending ? " is-pending" : ""}`}
      aria-label="ניווט בין עמודים"
    >
      <div className="pagination-info">
        מציג <strong>{from.toLocaleString("he-IL")}</strong>–
        <strong>{to.toLocaleString("he-IL")}</strong> מתוך{" "}
        <strong>{total.toLocaleString("he-IL")}</strong> {unit}
      </div>

      <div className="pagination-size">
        <label htmlFor="pageSize">שורות בעמוד</label>
        <select
          id="pageSize"
          value={pageSize}
          onChange={(e) => {
            const next = Number(e.target.value);
            // Keep the first row of the current view on screen after the
            // resize, so changing 25 -> 100 does not throw away your place.
            const anchor = (page - 1) * pageSize;
            const nextPage = Math.floor(anchor / next) + 1;
            startTransition(() =>
              router.push(
                listHref(basePath, params, { pageSize: next, page: nextPage }, defaults),
                { scroll: false },
              ),
            );
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {totalPages > 1 ? (
        <div className="pagination-pages">
          <PageLink
            href={href(page - 1)}
            disabled={page <= 1}
            label="לעמוד הקודם"
          >
            ‹
          </PageLink>

          {pageWindow(page, totalPages).map((p, i) =>
            p == null ? (
              <span className="pagination-gap" key={`gap-${i}`} aria-hidden="true">
                …
              </span>
            ) : (
              <PageLink
                key={p}
                href={href(p)}
                current={p === page}
                label={`לעמוד ${p}`}
              >
                {p.toLocaleString("he-IL")}
              </PageLink>
            ),
          )}

          <PageLink
            href={href(page + 1)}
            disabled={page >= totalPages}
            label="לעמוד הבא"
          >
            ›
          </PageLink>
        </div>
      ) : null}
    </nav>
  );
}

function PageLink({
  href,
  children,
  current = false,
  disabled = false,
  label,
}: {
  href: string;
  children: React.ReactNode;
  current?: boolean;
  disabled?: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="page-link is-disabled" aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`page-link${current ? " is-current" : ""}`}
      aria-current={current ? "page" : undefined}
      aria-label={label}
      scroll={false}
    >
      {children}
    </Link>
  );
}
