/**
 * Placeholder chrome shown by each route's `loading.tsx` while the server
 * renders. The point is that the page does not jump: the skeleton occupies the
 * same toolbar / table / pagination boxes the real content will.
 */

export function TableSkeleton({
  columns = 6,
  rows = 8,
  title = true,
}: {
  columns?: number;
  rows?: number;
  title?: boolean;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">טוען…</span>
      {title ? (
        <div className="page-header">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" style={{ width: "40%" }} />
        </div>
      ) : null}

      <div className="toolbar">
        <div className="toolbar-row">
          <div className="skeleton skeleton-input" />
          <div className="skeleton skeleton-select" />
          <div className="skeleton skeleton-select" />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i}>
                  <div className="skeleton skeleton-line" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c}>
                    <div
                      className="skeleton skeleton-line"
                      // Varying widths read as text rather than as a grid of bars.
                      style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CardListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">טוען…</span>
      <div className="page-header">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" style={{ width: "40%" }} />
      </div>
      <div className="toolbar">
        <div className="toolbar-row">
          <div className="skeleton skeleton-input" />
          <div className="skeleton skeleton-select" />
        </div>
      </div>
      <div className="stack">
        {Array.from({ length: count }).map((_, i) => (
          <div className="card" key={i}>
            <div className="skeleton skeleton-line" style={{ width: "30%" }} />
            <div className="skeleton skeleton-line" style={{ width: "80%", marginTop: 10 }} />
            <div className="skeleton skeleton-line" style={{ width: "60%", marginTop: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
