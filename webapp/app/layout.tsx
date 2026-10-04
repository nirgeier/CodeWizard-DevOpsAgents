import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "CodeWizard – מנוע הזדמנויות",
  description: "כלי פנימי לניהול הזדמנויות מכירה, איתותים, חברות ואנשי קשר",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <div className="layout">
          <Sidebar />
          <div className="main">
            <header className="header">
              <h1>CodeWizard – מנוע הזדמנויות</h1>
            </header>
            <div className="content">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}