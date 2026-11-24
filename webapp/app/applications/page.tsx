import { Suspense } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import ApplicationsClient from "./ApplicationsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "מעקב הגשות" };

/**
 * The tracker table is a client view - its rows come from the job tracker in
 * the browser - so the list state (q / stage / page / pageSize) is read by the
 * client component straight from the URL. `useSearchParams` still needs a
 * Suspense boundary on a server-rendered route, which is all this wrapper is.
 */
export default function ApplicationsPage() {
  return (
    <Suspense
      fallback={
        <div className="page-container">
          <TableSkeleton columns={6} rows={6} />
        </div>
      }
    >
      <ApplicationsClient />
    </Suspense>
  );
}
