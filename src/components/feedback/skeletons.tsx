import { cn } from "@/lib/class-names";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div className={cn("skeleton-pulse rounded-md bg-border/70", className)} />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5" aria-hidden="true">
      <SkeletonBlock className="size-10 rounded-lg" />
      <SkeletonBlock className="mt-5 h-4 w-2/3" />
      <SkeletonBlock className="mt-3 h-3 w-full" />
      <SkeletonBlock className="mt-2 h-3 w-4/5" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" aria-hidden="true">
      <div className="hidden grid-cols-4 gap-4 border-b border-border bg-muted/65 p-4 sm:grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-3" />
        ))}
      </div>
      <div className="hidden sm:block">{Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="grid min-h-14 grid-cols-4 items-center gap-4 border-b border-border p-4 last:border-0">
          {Array.from({ length: 4 }).map((__, column) => (
            <SkeletonBlock key={column} className="h-3" />
          ))}
        </div>
      ))}</div>
      <div className="divide-y divide-border sm:hidden">{Array.from({ length: Math.min(rows, 4) }).map((_, row) => (
        <div key={row} className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-4"><SkeletonBlock className="h-4 w-2/5" /><SkeletonBlock className="h-6 w-20 rounded-full" /></div>
          <SkeletonBlock className="h-3 w-3/4" />
          <div className="grid grid-cols-2 gap-3"><SkeletonBlock className="h-10" /><SkeletonBlock className="h-10" /></div>
          <SkeletonBlock className="h-11 w-full" />
        </div>
      ))}</div>
    </div>
  );
}

export function WorkspaceSkeleton({
  rows = 6,
  metrics = 0,
  filters = true,
}: {
  rows?: number;
  metrics?: number;
  filters?: boolean;
}) {
  return (
    <div
      className="mx-auto max-w-[1500px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Cargando información…</span>
      <SkeletonBlock className="h-3 w-40" />
      <SkeletonBlock className="mt-3 h-9 w-64 max-w-full" />
      <SkeletonBlock className="mt-3 h-4 w-96 max-w-full" />
      {filters && (
        <div className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.02)] sm:p-5">
          <SkeletonBlock className="h-4 w-44" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-11" />
            ))}
          </div>
        </div>
      )}
      {metrics > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: metrics }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      )}
      <div className="mt-4">
        <SkeletonTable rows={rows} />
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div
      className="mx-auto max-w-[1500px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Cargando detalle…</span>
      <SkeletonBlock className="h-4 w-36" />
      <SkeletonBlock className="mt-4 h-9 w-72 max-w-full" />
      <SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="h-52 rounded-xl border border-border bg-surface p-5 lg:col-span-2">
          <SkeletonBlock className="h-4 w-44" />
          <SkeletonBlock className="mt-5 h-32 w-full" />
        </div>
        <SkeletonCard />
      </div>
      <div className="mt-4">
        <SkeletonTable rows={4} />
      </div>
    </div>
  );
}
