<<<<<<< HEAD
import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "CodeWizard – מנוע הזדמנויות",
  description: "כלי פנימי לניהול הזדמנויות מכירה, איתותים, חברות ואנשי קשר",
};

=======
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

>>>>>>> origin/main
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>
<<<<<<< HEAD
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
=======
        <a className="skip-link" href="#content">
          דלג לתוכן
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
>>>>>>> origin/main
