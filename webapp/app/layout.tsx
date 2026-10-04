import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: {
    default: "CodeWizard – מנוע הזדמנויות",
    template: "%s · CodeWizard",
  },
  description: "כלי פנימי לניהול הזדמנויות מכירה, איתותים, חברות ואנשי קשר",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10366e",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <a className="skip-link" href="#content">
          דלג לתוכן
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
