import { TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <TableSkeleton columns={8} rows={8} />;
}
