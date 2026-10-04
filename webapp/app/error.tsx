"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Keeps a failed data read from blanking the whole
 * window - the sidebar and topbar survive, and `reset()` re-runs just this
 * segment, which is usually enough after a transient Supabase hiccup.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-container">
      <div className="empty-state">
        <div className="empty-state-icon" aria-hidden="true">
          !
        </div>
        <div className="empty-state-title">משהו השתבש בטעינת הדף</div>
        <p className="empty-state-hint">
          {error.message || "שגיאה לא צפויה."}
          {error.digest ? (
            <>
              <br />
              <code className="cell-uid">{error.digest}</code>
            </>
          ) : null}
        </p>
        <button className="btn btn-primary" type="button" onClick={reset}>
          נסו שוב
        </button>
      </div>
    </div>
  );
}
