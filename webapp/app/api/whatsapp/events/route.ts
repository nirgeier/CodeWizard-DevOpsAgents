import { NextResponse } from "next/server";
import { getSession } from "@/lib/whatsapp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events for the WhatsApp session.
 *
 * The tab needs three things pushed rather than polled: a fresh pairing QR
 * (which is only ever emitted once), connection-state changes, and the arrival
 * of new group messages. One stream carries all three, and closes when the
 * client goes away.
 */
export async function GET(request: Request) {
  const session = getSession();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const write = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          teardown();
        }
      };

      const unsubscribe = session.subscribe((state) => {
        // Send the QR only when it is new, otherwise every heartbeat would
        // push a ~40KB data URL to a browser that already has it.
        if (state.qr && state.qr !== lastQr) {
          lastQr = state.qr;
          write("qr", { dataUrl: state.qr, seq: state.qrSeq });
        }
        write("state", state);
      });

      let lastQr: string | null = session.state().qr;

      write("state", session.state());
      write("groups", { groups: session.listGroups() });

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          teardown();
        }
      }, 20000);

      function teardown() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      request.signal.addEventListener("abort", teardown);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}