"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "לוח בקרה" },
  { href: "/opportunities", label: "הזדמנויות" },
  { href: "/agents", label: "סוכנים" },
  { href: "/whatsapp", label: "WhatsApp" },
  { href: "/signals", label: "איתותים" },
  { href: "/companies", label: "חברות" },
  { href: "/people", label: "אנשי קשר" },
  { href: "/scans", label: "סריקות" },
  { href: "/help", label: "עזרה" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">
        <Link href="/" className="brand-link" aria-label="CodeWizard — לוח בקרה">
          <Image
            src="/codewizard-logo.png"
            alt="CodeWizard"
            width={117}
            height={32}
            className="brand-logo"
          />
        </Link>
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