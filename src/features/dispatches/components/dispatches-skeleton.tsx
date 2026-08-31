export function DispatchesSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className="mx-auto max-w-[1600px] animate-pulse" aria-label="Cargando despachos">
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="mt-3 h-9 w-64 rounded bg-muted" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-muted" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: detail ? 2 : 5 }, (_, index) => <div key={index} className="h-24 rounded-xl border border-border bg-surface" />)}
      </div>
      <div className="mt-5 h-28 rounded-xl border border-border bg-surface" />
      <div className="mt-5 h-[420px] rounded-xl border border-border bg-surface" />
    </div>
  );
}
