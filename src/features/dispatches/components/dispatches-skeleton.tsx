export function DispatchesSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className="skeleton-pulse mx-auto max-w-[1600px]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando despachos…</span>
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="mt-3 h-9 w-64 rounded bg-muted" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-muted" />
      <div className="mt-6 h-24 rounded-xl border border-border bg-surface" />
      <div className="mt-5 h-[360px] rounded-xl border border-border bg-surface" />
      {detail && <div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="h-64 rounded-xl border border-border bg-surface" /><div className="h-64 rounded-xl border border-border bg-surface" /></div>}
    </div>
  );
}
