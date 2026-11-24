import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseWeights, scoreFit } from "@/lib/fit";
import type { DevOpsJob } from "@/lib/types";

export const dynamic = "force-dynamic";

type AlertKind = "jobs" | "followup";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const mailKey = process.env.RESEND_API_KEY;
  const sender = process.env.ALERT_EMAIL_FROM;
  if (!url || !key || !mailKey || !sender || url.includes("your-project.supabase.co")) {
    return NextResponse.json({ error: "Email delivery is not configured" }, { status: 503 });
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const day = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;
  let failed = 0;

  async function deliver(userId: string, email: string, kind: AlertKind, subject: string, text: string) {
    const { data: claim, error: claimError } = await admin.from("alert_deliveries")
      .upsert({ user_id: userId, kind, day }, { onConflict: "user_id,kind,day", ignoreDuplicates: true })
      .select("user_id");
    if (claimError) throw claimError;
    if (!claim?.length) return;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${mailKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: sender, to: [email], subject, text }),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
      sent++;
    } catch (error) {
      await admin.from("alert_deliveries").delete().eq("user_id", userId).eq("kind", kind).eq("day", day);
      throw error;
    }
  }

  try {
    for (let offset = 0; ; offset += 100) {
      const { data: profiles, error } = await admin.from("user_preferences").select("user_id,keyword_weights,alerts_enabled,alert_min_score")
        .eq("alerts_enabled", true).range(offset, offset + 99);
      if (error) throw error;
      if (!profiles?.length) break;
      for (const profile of profiles) {
        try {
          const { data: identity, error: identityError } = await admin.auth.admin.getUserById(profile.user_id);
          if (identityError) throw identityError;
          const email = identity.user?.email_confirmed_at ? identity.user.email : null;
          if (!email) continue;

          const { data: dismissed, error: dismissError } = await admin.from("tracked_jobs").select("id")
            .eq("user_id", profile.user_id).eq("stage", "dismissed");
          if (dismissError) throw dismissError;
          const excluded = new Set((dismissed ?? []).map((job) => job.id));
          const weights = parseWeights(profile.keyword_weights);
          const matches: DevOpsJob[] = [];
          for (let start = 0; ; start += 500) {
            const { data: jobs, error: jobsError } = await admin.from("devops_jobs").select("*")
              .gte("first_seen_at", since).order("first_seen_at", { ascending: false }).range(start, start + 499);
            if (jobsError) throw jobsError;
            for (const job of jobs ?? []) {
              if (excluded.has(job.id)) continue;
              const score = weights.length ? scoreFit(job as DevOpsJob, weights).score : Number(job.score) * 100;
              if (score >= profile.alert_min_score) matches.push(job as DevOpsJob);
            }
            if (!jobs || jobs.length < 500) break;
          }
          if (matches.length) {
            const lines = matches.slice(0, 10).map((job) => `${job.title} - ${job.company}\n${/^https?:\/\//i.test(job.url || "") ? job.url : ""}`);
            await deliver(profile.user_id, email, "jobs", `${matches.length} משרות חדשות מתאימות`, `משרות שנמצאו ב-24 השעות האחרונות:\n\n${lines.join("\n\n")}\n\nלעדכון העדפות ההתראות, היכנסו להגדרות החשבון.`);
          }

          const { data: reminders, error: remindersError } = await admin.from("tracked_jobs").select("title,company,follow_up_at")
            .eq("user_id", profile.user_id).lte("follow_up_at", day).neq("follow_up_at", "")
            .in("stage", ["saved", "applied", "screening", "interview"]);
          if (remindersError) throw remindersError;
          if (reminders?.length) {
            const lines = reminders.slice(0, 10).map((job) => `${job.title} - ${job.company} (${job.follow_up_at})`);
            await deliver(profile.user_id, email, "followup", "תזכורת למעקב הגשות", `הגיע הזמן לבצע מעקב:\n\n${lines.join("\n")}\n\nלשינוי תאריכים, היכנסו למעקב ההגשות.`);
          }
        } catch (error) {
          failed++;
          console.error("Alert delivery failed for user", profile.user_id, error);
        }
      }
      if (profiles.length < 100) break;
    }
    return NextResponse.json({ sent, failed }, { status: failed ? 207 : 200 });
  } catch (error) {
    console.error("Alert delivery job failed", error);
    return NextResponse.json({ error: "Delivery job failed", sent, failed }, { status: 503 });
  }
}