export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Cargando">
      <div className="h-7 w-48 rounded bg-slate-200" />
      <div className="h-64 rounded-lg bg-white" />
    </div>
  );
}
