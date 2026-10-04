"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/**
 * The chrome around every page: sidebar, topbar, content well.
 *
 * It is a client component only because the mobile drawer needs open/closed
 * state. `children` stays a server-rendered subtree - passing it as a prop
 * means the pages inside are never pulled into the client bundle.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Navigating is the signal that the drawer has done its job. Without this a
  // tap on a link leaves the overlay covering the page you just asked for.
  useEffect(() => setNavOpen(false), [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className={`layout${navOpen ? " nav-open" : ""}`}>
      <Sidebar />
      {navOpen ? (
        <button
          type="button"
          className="nav-scrim"
          aria-label="סגור תפריט"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <div className="main">
        <Topbar onToggleNav={() => setNavOpen((open) => !open)} navOpen={navOpen} />
        <main className="content" id="content">
          {children}
        </main>
      </div>
    </div>
  );
}
