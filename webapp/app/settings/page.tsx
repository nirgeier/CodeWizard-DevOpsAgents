"use client";

import { useEffect, useRef, useState } from "react";
import { LuDownload, LuKeyRound, LuLogOut, LuPlus, LuRefreshCw, LuX } from "react-icons/lu";

interface Preferences {
  full_name: string;
  linkedin_url: string;
  github_url: string;
  cv_url: string;
  keyword_weights: { term: string; weight: number }[];
  alerts_enabled: boolean;
  alert_min_score: number;
}

const EMPTY: Preferences = {
  full_name: "", linkedin_url: "", github_url: "", cv_url: "",
  keyword_weights: [], alerts_enabled: false, alert_min_score: 70,
};

const CV_SKILLS = ["AWS", "Azure", "GCP", "Kubernetes", "Docker", "Terraform", "Ansible", "Python", "Linux", "GitOps", "ArgoCD", "Jenkins", "CI/CD", "Prometheus", "Grafana", "Helm", "SRE", "DevOps"];

function suggestedSkills(text: string, existing: Preferences["keyword_weights"]) {
  return CV_SKILLS.filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text) &&
      !existing.some((item) => item.term.toLocaleLowerCase() === term.toLocaleLowerCase());
  });
}

const STORAGE_OPTIONS = [
  { mode: "local", label: "מקומי (JSON)", description: "נתונים נשמרים בקבצים מקומיים בתיקיית data/." },
  { mode: "postgres", label: "Postgres", description: "דורש DATABASE_URL וסכמת בסיס נתונים מעודכנת." },
  { mode: "supabase", label: "Supabase", description: "דורש כתובת פרויקט ומפתח גישה בקובצי הסביבה." },
] as const;

interface Setting {
  key: string;
  value: unknown;
  description?: string | null;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [storageMode, setStorageMode] = useState<"local" | "postgres" | "supabase">("local");
  const [preferences, setPreferences] = useState<Preferences>(EMPTY);
  const [profileText, setProfileText] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [cvError, setCvError] = useState("");
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<"profile" | "cv" | "storage">("profile");
  const [profileStatus, setProfileStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [storageStatus, setStorageStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [syncSource, setSyncSource] = useState<"local" | "postgres" | "supabase">("local");
  const [syncTarget, setSyncTarget] = useState<"local" | "postgres" | "supabase">("supabase");
  const [syncTables, setSyncTables] = useState<{ table: string; source: number; target: number; missing: number }[] | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [storageRetry, setStorageRetry] = useState(0);
  const profileReady = useRef(false);
  const lastSavedProfile = useRef("");
  const profileRevision = useRef(0);
  const profileSaveQueue = useRef(Promise.resolve());
  const profileInFlight = useRef(false);
  const storageReady = useRef(false);
  const lastSavedMode = useRef(storageMode);
  const storageRevision = useRef(0);
  const storageSaveQueue = useRef(Promise.resolve());
  const storageInFlight = useRef(false);

  useEffect(() => {
    loadSettings();
    const passwordResult = new URLSearchParams(window.location.search).get("password");
    if (passwordResult) {
      setMessageTone(passwordResult === "updated" ? "success" : "error");
      setMessage(passwordResult === "updated" ? "הסיסמה עודכנה" : passwordResult === "invalid" ? "יש להזין סיסמה של 8 תווים לפחות ולאשר אותה" : "עדכון הסיסמה נכשל");
    }
  }, []);

  useEffect(() => {
    if (!profileReady.current) return;
    const revision = ++profileRevision.current;
    if (JSON.stringify(preferences) === lastSavedProfile.current && !profileInFlight.current) {
      setProfileStatus((status) => status === "idle" ? status : "saved");
      return;
    }
    setProfileStatus("pending");
    const timer = setTimeout(() => {
      profileSaveQueue.current = profileSaveQueue.current.then(async () => {
        if (revision !== profileRevision.current) return;
        if (preferences.keyword_weights.some(({ term, weight }) => !term.trim() || !Number.isInteger(weight) || weight < 1 || weight > 100)) {
          setProfileStatus("error");
          setMessageTone("error");
          setMessage("יש למלא מילת מפתח ומשקל בין 1 ל-100, או להסיר תגית ריקה.");
          return;
        }
        setProfileStatus("saving");
        profileInFlight.current = true;
        try {
          const res = await fetch("/api/preferences", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences),
          });
          if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
          lastSavedProfile.current = JSON.stringify(preferences);
          if (revision === profileRevision.current) {
            setProfileStatus("saved");
            setMessage(null);
          }
        } finally {
          profileInFlight.current = false;
        }
      }).catch((error) => {
        if (revision !== profileRevision.current) return;
        setProfileStatus("error");
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "שגיאה בשמירת הפרופיל");
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [preferences, profileRetry]);

  useEffect(() => {
    if (!storageReady.current) return;
    const revision = ++storageRevision.current;
    if (storageMode === lastSavedMode.current && !storageInFlight.current) {
      setStorageStatus((status) => status === "idle" ? status : "saved");
      return;
    }
    setStorageStatus("pending");
    const timer = setTimeout(() => {
      storageSaveQueue.current = storageSaveQueue.current.then(async () => {
        if (revision !== storageRevision.current) return;
        setStorageStatus("saving");
        storageInFlight.current = true;
        try {
          const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: "storage_mode",
              value: { mode: storageMode },
              description: "Data storage mode: local (JSON files), postgres, or supabase",
            }),
          });
          if (!res.ok) throw new Error("Failed to save");
          lastSavedMode.current = storageMode;
          if (revision === storageRevision.current) setStorageStatus("saved");
        } finally {
          storageInFlight.current = false;
        }
      }).catch(() => {
        if (revision === storageRevision.current) setStorageStatus("error");
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [storageMode, storageRetry]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      const profile = await fetch("/api/preferences", { cache: "no-store" });
      if (!profile.ok) throw new Error("Failed to load preferences");
      const result = await profile.json();
      const loaded = { ...EMPTY, ...result.preferences };
      lastSavedProfile.current = JSON.stringify(loaded);
      setPreferences(loaded);
      profileReady.current = true;
      
      const storageSetting = (data.settings || []).find((s: Setting) => s.key === "storage_mode");
      if (storageSetting && storageSetting.value) {
        const v = storageSetting.value as any;
        const mode = v.mode || v.storage_mode || "local";
        const loadedMode = mode === "supabase" ? "supabase" : mode === "postgres" ? "postgres" : "local";
        lastSavedMode.current = loadedMode;
        setStorageMode(loadedMode);
      }
      storageReady.current = true;
    } catch (err) {
      console.error(err);
      setMessageTone("error");
      setMessage("שגיאה בטעינת הגדרות");
    } finally {
      setLoading(false);
    }
  };

  const runSync = async (copy: boolean) => {
    if (syncSource === syncTarget) {
      setSyncNotice("יש לבחור שני מקורות אחסון שונים.");
      return;
    }
    setSyncBusy(true);
    setSyncNotice("");
    setSyncError(false);
    try {
      const res = await fetch(copy ? "/api/settings/sync" : `/api/settings/sync?source=${syncSource}&target=${syncTarget}`, {
        method: copy ? "POST" : "GET",
        headers: copy ? { "Content-Type": "application/json" } : undefined,
        body: copy ? JSON.stringify({ source: syncSource, target: syncTarget }) : undefined,
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "הסנכרון נכשל");
      if (copy) {
        setSyncNotice(`הועתקו ${data.results.reduce((sum: number, row: { copied: number }) => sum + row.copied, 0)} רשומות חסרות. רשומות קיימות לא שונו.`);
        setSyncTables(null);
      } else {
        setSyncTables(data.tables);
      }
    } catch (error) {
      setSyncTables(null);
      setSyncError(true);
      setSyncNotice(error instanceof Error ? error.message : "הסנכרון נכשל");
    } finally {
      setSyncBusy(false);
    }
  };

  const importProfile = async (file?: File) => {
    if (!file) return;
    setCvError("");
    if (file.type !== "application/pdf" || file.size > 10 * 1024 * 1024) {
      setCvError("יש לבחור PDF בגודל של עד 10MB.");
      return;
    }
    setImporting(true);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        pages.push(content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
      }
      const text = pages.join("\n\n").trim();
      if (!text) throw new Error("לא נמצא טקסט ב-PDF. יש לייצא את הפרופיל כ-PDF עם טקסט או להדביק את התוכן ידנית.");
      setProfileText(text);
      setSelectedSkills(suggestedSkills(text, preferences.keyword_weights));
    } catch (error) {
      setCvError(error instanceof Error && error.message.startsWith("לא נמצא") ? error.message : "לא ניתן לקרוא את ה-PDF. נסה לייצא אותו מחדש או להדביק את התוכן ידנית.");
    } finally {
      setImporting(false);
    }
  };

  const generateCv = () => {
    if (!profileText.trim()) {
      setCvError("יש לייבא PDF או להדביק תוכן מהפרופיל כדי ליצור קורות חיים.");
      return;
    }
    const preview = window.open("", "_blank");
    if (!preview) {
      setCvError("יש לאפשר חלונות קופצים כדי לפתוח את קורות החיים.");
      return;
    }
    setCvError("");
    const doc = preview.document;
    doc.title = `${preferences.full_name || "Profile"} - CV`;
    const style = doc.createElement("style");
    style.textContent = `@page { size: A4; margin: 18mm; } body { max-width: 175mm; margin: 32px auto; font: 11pt/1.5 Arial, sans-serif; color: #182b38; } h1 { font-size: 24pt; margin: 0 0 8px; } h2 { font-size: 11pt; text-transform: uppercase; border-bottom: 1px solid #a7b8c5; padding-bottom: 4px; margin: 24px 0 8px; } a { color: #156182; overflow-wrap: anywhere; } .links { display: flex; gap: 16px; flex-wrap: wrap; } p { white-space: pre-wrap; overflow-wrap: anywhere; } @media print { body { margin: 0; } }`;
    doc.head.append(style);
    const title = doc.createElement("h1");
    title.textContent = preferences.full_name.trim() || "CV";
    doc.body.append(title);
    const links = doc.createElement("div");
    links.className = "links";
    for (const [label, value] of [["LinkedIn", preferences.linkedin_url], ["GitHub", preferences.github_url]] as const) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") continue;
        const link = doc.createElement("a");
        link.href = url.href;
        link.textContent = label;
        links.append(link);
      } catch {
        continue;
      }
    }
    doc.body.append(links);
    const sections = profileText.trim().split(/\n\s*(?=Summary|Experience|Education|Skills|Projects|Certifications|תקציר|ניסיון|השכלה|כישורים|פרויקטים|הסמכות)\s*\n/iu);
    for (const section of sections) {
      const lines = section.trim().split("\n");
      const knownHeading = /^(Summary|Experience|Education|Skills|Projects|Certifications|תקציר|ניסיון|השכלה|כישורים|פרויקטים|הסמכות)$/iu.test(lines[0].trim());
      const heading = doc.createElement("h2");
      heading.textContent = knownHeading ? lines.shift()!.trim() : "Profile";
      const content = doc.createElement("p");
      content.textContent = lines.join("\n").trim();
      if (content.textContent) doc.body.append(heading, content);
    }
    preview.focus();
    preview.print();
  };

  return (
    <div className="settings-page page-container">
      <header className="page-header">
        <h2 className="page-title">הגדרות</h2>
      </header>
      {message && <p className={`settings-notice${messageTone === "error" ? " is-error" : ""}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}
      {profileStatus !== "idle" && <p className={`settings-save-status${profileStatus === "error" ? " is-error" : profileStatus === "saved" ? " is-saved" : ""}`} role="status">{profileStatus === "pending" ? "ממתין לשמירה…" : profileStatus === "saving" ? "שומר פרופיל…" : profileStatus === "saved" ? "הפרופיל נשמר" : "השמירה נכשלה"}{profileStatus === "error" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProfileRetry((count) => count + 1)}>נסה שוב</button>}</p>}
      <div className="settings-tabs" role="tablist" aria-label="קטגוריות הגדרות" onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const tabs = ["profile", "cv", "storage"] as const;
        const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowLeft" ? 1 : tabs.length - 1)) % tabs.length];
        setTab(next);
        document.getElementById(`settings-${next}-tab`)?.focus();
      }}>
        <button type="button" role="tab" id="settings-profile-tab" aria-selected={tab === "profile"} aria-controls="settings-profile-panel" tabIndex={tab === "profile" ? 0 : -1} onClick={() => setTab("profile")}>פרופיל והעדפות</button>
        <button type="button" role="tab" id="settings-cv-tab" aria-selected={tab === "cv"} aria-controls="settings-cv-panel" tabIndex={tab === "cv" ? 0 : -1} onClick={() => setTab("cv")}>קורות חיים מ-LinkedIn</button>
        <button type="button" role="tab" id="settings-storage-tab" aria-selected={tab === "storage"} aria-controls="settings-storage-panel" tabIndex={tab === "storage" ? 0 : -1} onClick={() => setTab("storage")}>תצורת פיתוח</button>
      </div>
      <section className="settings-panel" id="settings-profile-panel" role="tabpanel" aria-labelledby="settings-profile-tab" tabIndex={0} hidden={tab !== "profile"}>
        <h2>פרופיל אישי</h2>
        <fieldset className="settings-editor" disabled={loading}>
        <div className="settings-fields">
          {([ ["full_name", "שם מלא"], ["linkedin_url", "LinkedIn"], ["github_url", "GitHub"], ["cv_url", "קישור לקורות חיים או מסמך" ] ] as const).map(([field, label]) => (
            <label className="settings-field" key={field}>{label}
              <input type={field === "full_name" ? "text" : "url"}
                value={preferences[field]} onChange={(event) => setPreferences({ ...preferences, [field]: event.target.value })} />
            </label>
          ))}
        </div>
        <div className="settings-block">
          <h3>מילות מפתח ודירוג</h3>
          <div className="settings-keywords">
            {preferences.keyword_weights.map((item, index) => (
              <div className="settings-keyword" key={index}>
                <input aria-label={`מילת מפתח ${index + 1}`} placeholder="מילת מפתח" value={item.term}
                  onChange={(event) => setPreferences({ ...preferences, keyword_weights: preferences.keyword_weights.map((row, position) => position === index ? { ...row, term: event.target.value } : row) })} />
                <input className="settings-keyword-weight" aria-label={`משקל עבור ${item.term || `מילה ${index + 1}`} (1-100)`} type="number" min={1} max={100} value={item.weight}
                  onChange={(event) => setPreferences({ ...preferences, keyword_weights: preferences.keyword_weights.map((row, position) => position === index ? { ...row, weight: Number(event.target.value) } : row) })} />
                <button type="button" aria-label={`הסר ${item.term || `מילה ${index + 1}`}`} title="הסר מילת מפתח" onClick={() => setPreferences({ ...preferences, keyword_weights: preferences.keyword_weights.filter((_, position) => position !== index) })}><LuX aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost settings-add" type="button" onClick={() => setPreferences({ ...preferences, keyword_weights: [...preferences.keyword_weights, { term: "", weight: 50 }] })}><LuPlus aria-hidden="true" /> הוסף מילת מפתח</button>
        </div>
        <div className="settings-block">
          <h3>התראות</h3>
          <label className="settings-check"><input type="checkbox" checked={preferences.alerts_enabled}
            onChange={(event) => setPreferences({ ...preferences, alerts_enabled: event.target.checked })} /> התראות על משרות ותזכורות מעקב (דוא"ל כאשר שירות השליחה מוגדר)</label>
          <label className="settings-range"><span>סף התאמה להתראה <strong>{preferences.alert_min_score}%</strong></span>
            <input type="range" min={0} max={100} value={preferences.alert_min_score}
              onChange={(event) => setPreferences({ ...preferences, alert_min_score: Number(event.target.value) })} />
          </label>
        </div>
        </fieldset>
        <div className="settings-block">
          <h3>אבטחת חשבון</h3>
          <form action="/auth/action" method="post" className="settings-password">
            <div className="settings-fields">
              <label className="settings-field">סיסמה חדשה<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
              <label className="settings-field">אישור סיסמה<input name="confirmation" type="password" minLength={8} required autoComplete="new-password" /></label>
            </div>
            <div className="settings-actions"><button className="btn btn-ghost" type="submit" name="action" value="password"><LuKeyRound aria-hidden="true" /> עדכן סיסמה</button></div>
          </form>
          <form action="/auth/action" method="post" className="settings-signout"><button className="btn btn-ghost" type="submit" name="action" value="signout"><LuLogOut aria-hidden="true" /> התנתקות</button></form>
        </div>
      </section>
      <section className="settings-panel" id="settings-cv-panel" role="tabpanel" aria-labelledby="settings-cv-tab" tabIndex={0} hidden={tab !== "cv"}>
        <h2>קורות חיים מפרופיל LinkedIn</h2>
        <p>הורד את הפרופיל שלך כ-PDF מ-LinkedIn וייבא אותו כאן, או הדבק את תוכנו. בדוק את הטקסט לפני יצירת קורות החיים.</p>
        <label className="settings-field settings-cv-input">ייבוא פרופיל (PDF)
          <input type="file" accept="application/pdf,.pdf" disabled={importing} onChange={(event) => { void importProfile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <label className="settings-field settings-cv-input">תוכן קורות החיים
          <textarea value={profileText} onChange={(event) => { setProfileText(event.target.value); setSelectedSkills(suggestedSkills(event.target.value, preferences.keyword_weights)); setCvError(""); }} rows={10} placeholder="תקציר, ניסיון מקצועי, השכלה וכישורים" />
        </label>
        {selectedSkills.length > 0 && <div className="settings-block"><h3>כישורים שזוהו</h3>
          <div className="settings-keywords">{selectedSkills.map((term) => <label className="settings-check" key={term}><input type="checkbox" checked={selectedSkills.includes(term)} onChange={() => setSelectedSkills(selectedSkills.filter((skill) => skill !== term))} />{term}</label>)}</div>
          <button className="btn btn-ghost" type="button" onClick={() => { setPreferences({ ...preferences, keyword_weights: [...preferences.keyword_weights, ...selectedSkills.map((term) => ({ term, weight: 50 }))] }); setSelectedSkills([]); setTab("profile"); }}>הוסף למילות המפתח</button>
        </div>}
        {cvError && <p className="settings-save-status is-error" role="alert">{cvError}</p>}
        <div className="settings-actions"><button className="btn btn-primary" type="button" onClick={generateCv} disabled={loading || importing}><LuDownload aria-hidden="true" /> {importing ? "מייבא פרופיל…" : "צור קורות חיים / שמור כ-PDF"}</button></div>
      </section>
      <section className="settings-panel" id="settings-storage-panel" role="tabpanel" aria-labelledby="settings-storage-tab" tabIndex={0} hidden={tab !== "storage"}>
        <h2>תצורת פיתוח</h2>
        {loading ? <p role="status">טוען...</p> : (
          <>
            <div className="settings-options" role="radiogroup" aria-label="מצב אחסון">
              {STORAGE_OPTIONS.map((option) => (
                <label className={`settings-option${storageMode === option.mode ? " is-selected" : ""}`} key={option.mode}>
                  <input type="radio" name="storage_mode" value={option.mode} checked={storageMode === option.mode} onChange={() => setStorageMode(option.mode)} />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </div>
            {storageStatus !== "idle" && <p className={`settings-save-status${storageStatus === "error" ? " is-error" : storageStatus === "saved" ? " is-saved" : ""}`} role="status">{storageStatus === "pending" ? "ממתין לשמירה…" : storageStatus === "saving" ? "שומר אחסון…" : storageStatus === "saved" ? "מצב האחסון נשמר" : "השמירה נכשלה"}{storageStatus === "error" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStorageRetry((count) => count + 1)}>נסה שוב</button>}</p>}
            <div className="settings-block">
              <h3>סנכרון נתונים</h3>
              <p>העתקת רשומות חסרות בלבד בין קובצי JSON, Postgres ו-Supabase. רשומות קיימות ביעד לא יוחלפו. העדפות אישיות ומעקב משרות אינם נכללים.</p>
              <div className="settings-fields">
                <label className="settings-field">מקור
                  <select value={syncSource} disabled={syncBusy} onChange={(event) => { setSyncSource(event.target.value as typeof syncSource); setSyncTables(null); setSyncNotice(""); }}>
                    {STORAGE_OPTIONS.map((option) => <option key={option.mode} value={option.mode}>{option.label}</option>)}
                  </select>
                </label>
                <label className="settings-field">יעד
                  <select value={syncTarget} disabled={syncBusy} onChange={(event) => { setSyncTarget(event.target.value as typeof syncTarget); setSyncTables(null); setSyncNotice(""); }}>
                    {STORAGE_OPTIONS.map((option) => <option key={option.mode} value={option.mode}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="settings-actions">
                <button type="button" className="btn btn-ghost" disabled={syncBusy || syncSource === syncTarget} onClick={() => void runSync(false)}><LuRefreshCw aria-hidden="true" /> {syncBusy ? "בודק…" : "בדוק נתונים חסרים"}</button>
                <button type="button" className="btn btn-primary" disabled={syncBusy || syncSource === syncTarget || !syncTables?.some((row) => row.missing)} onClick={() => void runSync(true)}><LuRefreshCw aria-hidden="true" /> העתק רשומות חסרות</button>
              </div>
              {syncTables && <p role="status">{syncTables.reduce((sum, row) => sum + row.missing, 0)} רשומות חסרות ביעד ({syncTables.filter((row) => row.missing).map((row) => `${row.table}: ${row.missing}`).join(", ") || "הנתונים מעודכנים"}).</p>}
              {syncNotice && <p role={syncError ? "alert" : "status"} className={`settings-save-status${syncError ? " is-error" : ""}`}>{syncNotice}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
