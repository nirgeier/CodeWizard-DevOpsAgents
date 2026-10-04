import { TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <TableSkeleton columns={5} rows={8} />;
}
