import { Card, Skeleton, TableSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="border-b border-line p-3"><Skeleton className="h-9 w-64 max-w-full" /></div>
        <TableSkeleton />
      </Card>
    </div>
  );
}
