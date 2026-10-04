"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OpportunityActions({
  id,
  status,
}: {
  id: string;
  status?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "approved" | "rejected">(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: "approved" | "rejected") {
    setPending(next);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בעדכון");
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="actions">
        <button
          className="btn btn-approve"
          onClick={() => setStatus("approved")}
          disabled={pending !== null || status === "approved"}
        >
          {pending === "approved" ? "מאשר…" : "אשר הזדמנות"}
        </button>
        <button
          className="btn btn-reject"
          onClick={() => setStatus("rejected")}
          disabled={pending !== null || status === "rejected"}
        >
          {pending === "rejected" ? "דוחה…" : "דחה הזדמנות"}
        </button>
      </div>
      {error && <div className="action-note">שגיאה: {error}</div>}
    </div>
  );
}
