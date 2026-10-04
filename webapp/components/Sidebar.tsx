"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "לוח בקרה" },
  { href: "/opportunities", label: "הזדמנויות" },
  { href: "/agents", label: "סוכנים" },
  { href: "/signals", label: "איתותים" },
  { href: "/companies", label: "חברות" },
  { href: "/people", label: "אנשי קשר" },
  { href: "/scans", label: "סריקות" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">
          Code<span>Wizard</span>
        </div>
        <div className="tagline">מנוע הזדמנויות · Jobs Intel</div>
      </div>

      <nav className="nav">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "active" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div style={{ marginTop: 10 }}>CodeWizard – מנוע הזדמנויות</div>
        <div>Internal tool · v1.0</div>
      </div>
    </aside>
  );
}