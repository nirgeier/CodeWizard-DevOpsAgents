"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { LuLogOut, LuMoon, LuSun } from "react-icons/lu";
import { currentNavItem } from "@/lib/nav";

/**
 * Page header: what you are looking at, and the two controls that belong to
 * the window rather than to the page - the mobile nav toggle and a refresh
 * that re-runs the server render without a full browser reload.
 */
export default function Topbar({
  onToggleNav,
  navOpen,
  theme,
  onThemeChange,
}: {
  onToggleNav: () => void;
  navOpen: boolean;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  const item = currentNavItem(pathname);
  const isHome = pathname === "/";

  return (
    <header className="header">
      <button
        type="button"
        className="nav-toggle"
        aria-label={navOpen ? "סגור תפריט" : "פתח תפריט"}
        aria-expanded={navOpen}
        onClick={onToggleNav}
      >
        <span aria-hidden="true">☰</span>
      </button>

      <div className="header-titles">
        <nav className="breadcrumb" aria-label="מיקום">
          {isHome ? (
            <span>לוח בקרה</span>
          ) : (
            <>
              <Link href="/">לוח בקרה</Link>
              <span className="breadcrumb-sep" aria-hidden="true">
                ‹
              </span>
              <span aria-current="page">{item?.label ?? "דף"}</span>
            </>
          )}
        </nav>
        <h1>{item?.label ?? "CodeWizard"}</h1>
      </div>

      <div className="header-actions">
        <div className="theme-switch" role="group" aria-label="ערכת נושא">
          <button type="button" title="מצב בהיר" aria-label="מצב בהיר" aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}><LuSun aria-hidden="true" /></button>
          <button type="button" title="מצב כהה" aria-label="מצב כהה" aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}><LuMoon aria-hidden="true" /></button>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={isRefreshing}
          title="רענן נתונים"
        >
          <span className={isRefreshing ? "spin" : undefined} aria-hidden="true">
            ↻
          </span>{" "}
          {isRefreshing ? "מרענן…" : "רענן"}
        </button>
        <form action="/auth/action" method="post">
          <button type="submit" name="action" value="signout" className="btn btn-ghost btn-sm header-logout" title="התנתקות">
            <LuLogOut aria-hidden="true" /> התנתקות
          </button>
        </form>
      </div>
    </header>
  );
}
