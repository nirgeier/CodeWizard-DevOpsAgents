// One description of the app's routes, used by the sidebar (to render the nav)
// and the topbar (to title the current page). Keeping them in sync by hand is
// how a nav label and a page heading drift apart.

export interface NavItem {
  href: string;
  label: string;
  /** Rendered as the nav glyph. Unicode keeps the bundle free of an icon set. */
  icon: string;
  description?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "סקירה",
    items: [
      { href: "/", label: "לוח בקרה", icon: "◳", description: "סקירה כללית של הצבר" },
    ],
  },
  {
    title: "צבר",
    items: [
      { href: "/opportunities", label: "הזדמנויות", icon: "◆", description: "הזדמנויות מכירה" },
      { href: "/signals", label: "איתותים", icon: "◇", description: "איתותי שוק וגיוס" },
      { href: "/companies", label: "חברות", icon: "▣", description: "פרופילי חברות" },
      { href: "/people", label: "אנשי קשר", icon: "☗", description: "אנשי מפתח" },
    ],
  },
  {
    title: "מקורות",
    items: [
      { href: "/agents", label: "סוכנים", icon: "⚙", description: "הרצת סוכני סריקה" },
      { href: "/jobs", label: "משרות", icon: "☰", description: "משרות שנסרקו, מכל המקורות" },
      { href: "/whatsapp", label: "WhatsApp", icon: "✆", description: "סריקת קבוצות" },
      { href: "/scans", label: "סריקות", icon: "↻", description: "היסטוריית ריצות" },
    ],
  },
  {
    title: "",
    items: [{ href: "/help", label: "עזרה", icon: "?", description: "מדריך השימוש" }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** True when `href` is the nav entry a given pathname belongs under. */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The nav entry a pathname sits under, longest match first.
 *
 * Longest-first matters for nested routes: `/opportunities/<id>` must resolve
 * to "הזדמנויות" rather than to the dashboard at "/".
 */
export function currentNavItem(pathname: string): NavItem | null {
  const matches = NAV_ITEMS.filter((item) => isActive(item.href, pathname));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) =>
    item.href.length > best.href.length ? item : best,
  );
}
