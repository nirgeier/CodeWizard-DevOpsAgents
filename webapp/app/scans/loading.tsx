import { TableSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return <TableSkeleton columns={9} rows={6} />;
}
