import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-container">
      <div className="empty-state">
        <div className="empty-state-icon" aria-hidden="true">
          ⌕
        </div>
        <div className="empty-state-title">הדף לא נמצא</div>
        <p className="empty-state-hint">
          ייתכן שהקישור ישן, או שהרשומה נמחקה מאז.
        </p>
        <Link className="btn btn-primary" href="/">
          חזרה ללוח הבקרה
        </Link>
      </div>
    </div>
  );
}
