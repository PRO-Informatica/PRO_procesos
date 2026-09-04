export function ProgrammingSkeleton() {
  return (
    <div className="skeleton-pulse mx-auto max-w-[1600px]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando programación…</span>
      <div className="flex items-end justify-between gap-5">
        <div>
          <div className="h-3 w-44 rounded bg-muted" />
          <div className="mt-3 h-9 w-60 rounded bg-muted" />
          <div className="mt-3 h-4 w-80 max-w-full rounded bg-muted" />
        </div>
        <div className="hidden h-11 w-72 rounded-xl bg-muted sm:block" />
      </div>
      <div className="mt-5 h-24 rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.02)]">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="mt-4 h-11 rounded-lg bg-muted" />
      </div>
      <div className="mt-4 h-[680px] rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="h-10 w-28 rounded-lg bg-muted" />
          <div className="h-8 w-44 rounded-lg bg-muted" />
        </div>
        <div className="mt-5 grid h-[570px] grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="rounded-lg bg-muted/75" />
          ))}
        </div>
      </div>
    </div>
  );
}
