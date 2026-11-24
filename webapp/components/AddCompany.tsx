"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LuPlus, LuX } from "react-icons/lu";

const EMPTY = { name: "", domain: "", industry: "", country: "", hq_city: "" };

export default function AddCompany() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/companies", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "שמירת החברה נכשלה.");
      setDraft(EMPTY);
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "שמירת החברה נכשלה.");
    } finally {
      setSaving(false);
    }
  };

  return <>
    <button className="btn btn-primary source-add-button" type="button" onClick={() => { setError(""); setOpen(true); }}><LuPlus aria-hidden="true" /> הוסף חברה</button>
    <dialog ref={dialog} className="source-dialog" aria-labelledby="company-dialog-title" onClose={() => setOpen(false)}>
      <form className="source-dialog-form" onSubmit={save}>
        <div className="source-dialog-heading">
          <h2 id="company-dialog-title">הוסף חברה</h2>
          <button type="button" className="source-dialog-close" aria-label="סגור" title="סגור" onClick={() => setOpen(false)}><LuX aria-hidden="true" /></button>
        </div>
        {([ ["name", "שם החברה"], ["domain", "דומיין (לא חובה)"], ["industry", "תחום (לא חובה)"], ["country", "מדינה (לא חובה)"], ["hq_city", "עיר (לא חובה)"] ] as const).map(([key, label]) => (
          <label className="source-dialog-field" key={key}>{label}
            <input required={key === "name"} maxLength={key === "domain" ? 253 : 120} dir={key === "domain" ? "ltr" : undefined}
              placeholder={key === "domain" ? "company.com" : undefined} value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
          </label>
        ))}
        {error && <p className="source-dialog-error" role="alert">{error}</p>}
        <div className="source-dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>ביטול</button>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "שומר..." : "הוסף חברה"}</button>
        </div>
      </form>
    </dialog>
  </>;
}