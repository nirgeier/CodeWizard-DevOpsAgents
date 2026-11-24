"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LuBookmark, LuCheck, LuEyeOff } from "react-icons/lu";
import { cachedTrackedJobs, loadTrackedJobs, removeTrackedJob, saveTrackedJob, TRACKER_CHANGE, type JobStage, type TrackedJob } from "@/lib/job-tracker";

export default function JobTrackerActions({ job }: { job: Pick<TrackedJob, "id" | "title" | "company" | "url"> }) {
  const [stage, setStage] = useState<JobStage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const sync = () => setStage(cachedTrackedJobs().find((item) => item.id === job.id)?.stage || null);
    loadTrackedJobs().catch(() => setError(true));
    window.addEventListener(TRACKER_CHANGE, sync);
    return () => {
      window.removeEventListener(TRACKER_CHANGE, sync);
    };
  }, [job.id]);

  const update = async (nextStage: JobStage) => {
    const jobs = cachedTrackedJobs();
    const existing = jobs.find((item) => item.id === job.id);
    const record: TrackedJob = {
      ...job,
      stage: nextStage,
      appliedAt: nextStage === "applied" ? existing?.appliedAt || new Date().toISOString().slice(0, 10) : "",
      followUpAt: existing?.followUpAt || "",
      notes: existing?.notes || "",
      updatedAt: new Date().toISOString(),
    };
    try { await saveTrackedJob(record); setError(false); }
    catch { setError(true); }
  };

  return (
    <div className="job-tracker-actions">
      {!stage ? (
        <>
          <button type="button" className="btn btn-ghost" onClick={() => update("saved")} title="שמור למעקב"><LuBookmark aria-hidden="true" /> שמור</button>
          <button type="button" className="btn btn-ghost" onClick={() => update("applied")} title="סמן הגשה שביצעת"><LuCheck aria-hidden="true" /> סמן כהוגשה</button>
          <button type="button" className="btn btn-ghost" onClick={() => update("dismissed")} title="הסתר ממשרות והתראות"><LuEyeOff aria-hidden="true" /> לא מתאים</button>
        </>
      ) : stage === "dismissed" ? <button type="button" className="btn btn-ghost" onClick={async () => { try { await removeTrackedJob(job.id); setError(false); } catch { setError(true); } }}>בטל הסתרה</button> : <Link href="/applications" className="job-tracker-link">{stage === "saved" ? "נשמר למעקב" : "במעקב הגשות"}</Link>}
      {error && <span className="job-tracker-error" role="alert">המעקב אינו זמין כרגע</span>}
    </div>
  );
}