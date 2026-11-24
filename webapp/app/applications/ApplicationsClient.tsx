"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { LuPlus, LuX } from "react-icons/lu";
import { cachedTrackedJobs, loadTrackedJobs, removeTrackedJob, saveTrackedJob, TRACKER_CHANGE, type JobStage, type TrackedJob } from "@/lib/job-tracker";
import { parseListParams, type ListParamsSpec, type RawParams } from "@/lib/query";
import DataToolbar from "@/components/DataToolbar";
import Pagination from "@/components/Pagination";

const BASE = "/applications";

/**
 * The tracker speaks the same URL contract as every other list view
 * (?q=&stage=&page=&pageSize=), so a filtered, half-way-read view is a
 * shareable link and the Back button steps through it. There is nothing to
 * sort by in this table, hence the empty `sortable`.
 */
const SPEC: ListParamsSpec = {
  sortable: [],
  defaultSort: "",
  filters: ["stage"],
};

const DEFAULTS = { defaultSort: SPEC.defaultSort, defaultDir: SPEC.defaultDir };

const STAGES: { value: JobStage; label: string }[] = [
  { value: "saved", label: "נשמר" },
  { value: "applied", label: "הוגשה" },
  { value: "screening", label: "בבדיקה" },
  { value: "interview", label: "ראיון" },
  { value: "offer", label: "הצעה" },
  { value: "rejected", label: "נדחתה" },
  { value: "dismissed", label: "לא מתאים" },
];

const EMPTY: TrackedJob = {
  id: "", title: "", company: "", url: "", stage: "applied",
  appliedAt: "", followUpAt: "", notes: "", updatedAt: "",
};

export default function ApplicationsClient() {
  const searchParams = useSearchParams();
  const params = parseListParams(
    Object.fromEntries(searchParams.entries()) as RawParams,
    SPEC,
  );
  const stage = params.filters.stage ?? "all";

  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TrackedJob>(EMPTY);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const sync = () => setJobs(cachedTrackedJobs());
    loadTrackedJobs().catch(() => setError("לא ניתן לטעון את המעקב מהחשבון.")).finally(() => setReady(true));
    window.addEventListener(TRACKER_CHANGE, sync);
    return () => {
      window.removeEventListener(TRACKER_CHANGE, sync);
    };
  }, []);

  useEffect(() => {
    if (editing) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [editing]);

  const remove = async (id: string) => {
    try { await removeTrackedJob(id); setError(""); }
    catch { setError("לא ניתן להסיר את המשרה מהחשבון."); }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    const company = draft.company.trim();
    const url = draft.url.trim();
    if (!title || !company) return;
    if (url && !/^https?:\/\//i.test(url)) {
      setError("יש להזין קישור http או https.");
      return;
    }
    const record: TrackedJob = {
      ...draft, id: draft.id || `manual:${crypto.randomUUID()}`,
      title, company, url,
      appliedAt: ["saved", "dismissed"].includes(draft.stage) ? "" : draft.appliedAt || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    try { await saveTrackedJob(record); setError(""); setEditing(false); }
    catch { setError("לא ניתן לשמור את המשרה בחשבון."); }
  };

  const visible = jobs.filter((job) =>
    (stage === "all" || job.stage === stage) &&
    `${job.title} ${job.company}`.toLocaleLowerCase().includes(params.q.toLocaleLowerCase()));
  const due = (date: string) => date && date <= new Date().toISOString().slice(0, 10);

  // Rows are held in memory and filtered in place, so the slice is computed
  // here rather than by the data layer. The page is clamped to the last page:
  // filtering or deleting the last row of page N must not leave the URL
  // pointing at a page that no longer exists.
  const total = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const page = Math.min(params.page, totalPages);
  const rows = visible.slice((page - 1) * params.pageSize, page * params.pageSize);

  const toolbarFilters = [
    {
      key: "stage",
      label: "שלב",
      options: STAGES.map((option) => ({ value: option.value, label: option.label })),
      allLabel: "כל השלבים",
    },
  ];

  const pager = (placement: "top" | "bottom") => (
    <Pagination
      basePath={BASE}
      params={params}
      defaults={DEFAULTS}
      page={page}
      pageSize={params.pageSize}
      total={total}
      totalPages={totalPages}
      unit="הגשות"
      placement={placement}
    />
  );

  return (
    <div className="page-container applications-page">
      <div className="page-header">
        <h2 className="page-title">מעקב הגשות</h2>
        <p className="page-sub">משרות שמורות, הגשות ותאריכי מעקב בחשבון שלך.</p>
        <button type="button" className="btn btn-primary applications-add" onClick={() => { setDraft(EMPTY); setError(""); setEditing(true); }}><LuPlus aria-hidden="true" /> הוסף הגשה</button>
      </div>

      <div className="applications-summary" aria-label="סיכום מעקב">
        <span><strong>{jobs.filter((job) => job.stage !== "dismissed").length}</strong> במעקב</span>
        <span><strong>{jobs.filter((job) => job.stage === "saved").length}</strong> שמורות</span>
        <span><strong>{jobs.filter((job) => job.followUpAt && due(job.followUpAt) && !["offer", "rejected", "dismissed"].includes(job.stage)).length}</strong> למעקב היום</span>
      </div>

      <DataToolbar
        basePath={BASE}
        params={params}
        defaults={DEFAULTS}
        filters={toolbarFilters}
        searchPlaceholder="תפקיד או חברה"
        total={total}
      />

      {pager("top")}

      {error && !editing && <p role="alert" className="applications-error">{error}</p>}
      {!ready ? <p role="status">טוען מעקב…</p> : total === 0 ? (
        <div className="empty-state">
          {jobs.length ? "אין הגשות התואמות לסינון." : <>אין עדיין משרות במעקב. <Link href="/jobs">מצאו משרות</Link> או הוסיפו הגשה ידנית.</>}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="applications-table">
              <thead><tr><th>משרה</th><th>חברה</th><th>שלב</th><th>תאריך הגשה</th><th>מעקב הבא</th><th>פעולות</th></tr></thead>
              <tbody>{rows.map((job) => (
                <tr key={job.id}>
                  <td>{job.url && /^https?:\/\//i.test(job.url) ? <a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a> : job.title}</td>
                  <td>{job.company}</td>
                  <td>{STAGES.find((option) => option.value === job.stage)?.label}</td>
                  <td>{job.appliedAt || "—"}</td>
                  <td className={job.followUpAt && due(job.followUpAt) && !["offer", "rejected", "dismissed"].includes(job.stage) ? "applications-due" : ""}>{job.followUpAt || "—"}</td>
                  <td className="applications-actions">
                    {job.stage === "dismissed" ? <button type="button" className="btn btn-ghost" onClick={() => { void remove(job.id); }}>החזר לתוצאות</button> : <button type="button" className="btn btn-ghost" onClick={() => { setDraft(job); setError(""); setEditing(true); }}>ערוך</button>}
                    <button type="button" className="btn btn-ghost" onClick={() => { if (window.confirm(`להסיר את ${job.title} מהמעקב?`)) void remove(job.id); }}>הסר</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {pager("bottom")}
        </>
      )}

      <dialog ref={dialogRef} className="source-dialog applications-dialog" aria-labelledby="applications-dialog-title" onClose={() => setEditing(false)}>
        <form className="source-dialog-form" onSubmit={save}>
          <div className="source-dialog-heading">
            <h2 id="applications-dialog-title">{draft.id ? "עריכת מעקב" : "הוסף הגשה ידנית"}</h2>
            <button type="button" className="source-dialog-close" aria-label="סגור" onClick={() => setEditing(false)}><LuX aria-hidden="true" /></button>
          </div>
          <label className="source-dialog-field">תפקיד<input required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="source-dialog-field">חברה<input required maxLength={160} value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></label>
          <label className="source-dialog-field">קישור למשרה (לא חובה)<input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} dir="ltr" /></label>
          <label className="source-dialog-field">שלב<select value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value as JobStage })}>
            {STAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          {draft.stage !== "saved" && draft.stage !== "dismissed" && <label className="source-dialog-field">תאריך הגשה<input type="date" value={draft.appliedAt} onChange={(event) => setDraft({ ...draft, appliedAt: event.target.value })} /></label>}
          <label className="source-dialog-field">תזכורת מעקב<input type="date" value={draft.followUpAt} onChange={(event) => setDraft({ ...draft, followUpAt: event.target.value })} /></label>
          <label className="source-dialog-field">הערות<textarea rows={3} maxLength={2000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
          {error && <p className="applications-error" role="alert">{error}</p>}
          <div className="source-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>ביטול</button>
            <button type="submit" className="btn btn-primary">שמור</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
