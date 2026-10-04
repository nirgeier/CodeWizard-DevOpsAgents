import { NextResponse } from "next/server";
import { getSession } from "@/lib/whatsapp/session";
import { extractJobs } from "@/lib/whatsapp/extract";
import { saveJobs, type SaveJobsResult } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Extract DevOps job posts from captured WhatsApp messages and write them to
 * `devops_jobs`, where the rest of the app already reads them.
 *
 *   POST { jids?: [...], limit?, since?, save?: true, history?: 0 }
 *
 * `history` pulls that many recent messages from the phone before scanning,
 * which is how a freshly monitored group gets its backlog.
 */
export async function POST(request: Request) {
  const session = getSession();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* empty body = scan everything monitored */
  }

  if (!session.isRunning()) {
    return NextResponse.json({ error: "הסשן לא מחובר" }, { status: 409 });
  }

  const requested = Array.isArray(body.jids) && body.jids.length ? (body.jids as string[]) : null;
  const jids = requested || session.monitoredJids();
  if (!jids.length) {
    return NextResponse.json(
      { error: "לא נבחרו קבוצות. סמנו קבוצה לניטור קודם." },
      { status: 400 },
    );
  }

  const limit = Math.max(1, Math.min(Number(body.limit || 200), 500));
  const since = body.since ? Number(body.since) : undefined;
  const history = Number(body.history || 0);

  const pulled: Array<{ jid: string | null; newMessages: number }> = [];
  if (history > 0) {
    for (const jid of jids) {
      try {
        const r = await session.fetchHistory(jid, history);
        pulled.push({ jid: r.jid, newMessages: r.newMessages });
      } catch {
        // One group refusing history must not sink the whole scan.
        pulled.push({ jid, newMessages: 0 });
      }
    }
  }

  const messages = [];
  for (const jid of jids) {
    const r = await session.listMessages({ jid, limit, since });
    messages.push(...r.messages);
  }

  const { jobs, scanned } = extractJobs(messages, (m) =>
    session.listGroups().find((g) => g.jid === m.jid)?.subject,
  );

  let saved: SaveJobsResult = { mode: "local", inserted: 0, skipped: 0 };
  if (body.save !== false && jobs.length) {
    saved = await saveJobs(jobs);
  }

  return NextResponse.json({
    ok: true,
    groups: jids,
    scanned,
    matched: jobs.length,
    history: pulled,
    saved: {
      inserted: saved.inserted,
      skipped: saved.skipped,
      mode: saved.mode,
      error: saved.error ?? null,
    },
    jobs: jobs.slice(0, 50),
  });
}