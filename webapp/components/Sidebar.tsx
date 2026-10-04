"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, NAV_GROUPS } from "@/lib/nav";

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar" id="app-nav">
      <div className="brand">
        <Link href="/" className="brand-link" aria-label="CodeWizard — לוח בקרה">
          <Image
            src="/codewizard-logo.png"
            alt="CodeWizard"
            width={117}
            height={32}
            className="brand-logo"
            priority
          />
        </Link>
        <div className="tagline">מנוע הזדמנויות · Jobs Intel</div>
      </div>

      <nav className="nav" aria-label="ניווט ראשי">
        {NAV_GROUPS.map((group, i) => (
          <div className="nav-group" key={group.title || `group-${i}`}>
            {group.title ? (
              <div className="nav-group-title">{group.title}</div>
            ) : null}
            {group.items.map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "active" : undefined}
                  aria-current={active ? "page" : undefined}
                  title={item.description}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-hint">
          <kbd>/</kbd> לחיפוש בטבלה
        </div>
        <div style={{ marginTop: 10 }}>CodeWizard – מנוע הזדמנויות</div>
        <div>Internal tool · v1.0</div>
      </div>
    </aside>
  );
}