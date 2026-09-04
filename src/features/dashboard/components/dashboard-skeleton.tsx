import { SkeletonBlock, SkeletonCard, SkeletonTable } from "@/components/feedback/skeletons";

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando dashboard…</span>
      <SkeletonBlock className="h-8 w-64" />
      <SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <SkeletonTable rows={5} />
        <SkeletonCard />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}
