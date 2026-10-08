import { Card, Skeleton, TableSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <div className="page-head -mt-4 space-y-2 md:-mt-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="kpis mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="border-b border-line p-3"><Skeleton className="h-9 w-64 max-w-full" /></div>
        <TableSkeleton />
      </Card>
    </div>
  );
}
