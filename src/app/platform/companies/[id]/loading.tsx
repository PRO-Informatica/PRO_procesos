import { SkeletonCard, SkeletonTable } from "@/components/feedback/skeletons";

export default function CompanyDetailLoading() {
  return (
    <div className="mx-auto max-w-[1320px]" aria-label="Cargando detalle de empresa">
      <div className="h-4 w-24 animate-pulse rounded bg-border/60" />
      <div className="mt-5 h-44 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <div className="mt-6">
        <SkeletonTable rows={4} />
      </div>
    </div>
  );
}
