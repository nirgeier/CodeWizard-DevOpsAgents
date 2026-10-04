"use client";

import { useEffect, useState } from "react";

interface Setting {
  key: string;
  value: unknown;
  description?: string | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<"local" | "supabase">("local");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      setSettings(data.settings || []);
      
      const storageSetting = (data.settings || []).find((s: Setting) => s.key === "storage_mode");
      if (storageSetting && storageSetting.value) {
        const v = storageSetting.value as any;
        const mode = v.mode || v.storage_mode || "local";
        setStorageMode(mode === "supabase" ? "supabase" : "local");
      }
    } catch (err) {
      console.error(err);
      setMessage("שגיאה בטעינת הגדרות");
    } finally {
      setLoading(false);
    }
  };

  const saveStorageMode = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "storage_mode",
          value: { mode: storageMode },
          description: "Data storage mode: local (JSON files) or supabase",
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setMessage("ההגדרות נשמרו בהצלחה - הרעננו את הדף כדי שהשינוי ייכנס לתוקף");
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      console.error(err);
      setMessage("שגיאה בשמירת ההגדרות");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <h2>הגדרות</h2>
        <p>כאן ניתן להגדיר את אופן עבודה המערכת.</p>

        {loading && <div>טוען...</div>}
        {message && <div style={{ padding: "1rem", background: "#e7f5e7", borderRadius: "4px", marginTop: "1rem" }}>{message}</div>}

        {!loading && (
          <div style={{ marginTop: "2rem" }}>
            <h3>מצב עבודה</h3>
            <div style={{ marginTop: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <input
                  type="radio"
                  name="storage_mode"
                  value="local"
                  checked={storageMode === "local"}
                  onChange={(e) => setStorageMode(e.target.value as "local" | "supabase")}
                />
                <strong>עבודה מקומית (JSON)</strong>
              </label>
              <p style={{ marginRight: "1.5rem", color: "#666", marginTop: "-0.5rem" }}>
                כל הנתונים נשמרים בקבצי JSON בתיקייה data/. מתאים לתורמים שמפתחים ללא חשבון Supabase.
              </p>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1.5rem" }}>
                <input
                  type="radio"
                  name="storage_mode"
                  value="supabase"
                  checked={storageMode === "supabase"}
                  onChange={(e) => setStorageMode(e.target.value as "local" | "supabase")}
                />
                <strong>עבודה עם Supabase</strong>
              </label>
              <p style={{ marginRight: "1.5rem", color: "#666", marginTop: "-0.5rem" }}>
                הנתונים נשמרים ב-Supabase. יש להגדיר SUPABASE_URL ו-SUPABASE_PUBLISHABLE_KEY בקבצי הסביבה.
              </p>
            </div>

            <div style={{ marginTop: "2rem" }}>
              <button
                onClick={saveStorageMode}
                disabled={saving}
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#0070f3",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "שומר..." : "שמור הגדרות"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
