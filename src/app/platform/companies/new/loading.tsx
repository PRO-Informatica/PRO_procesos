import { SkeletonCard } from "@/components/feedback/skeletons";

export default function NewCompanyLoading() {
  return (
    <div className="mx-auto max-w-2xl" aria-label="Cargando formulario de empresa">
      <SkeletonCard />
      <div className="mt-4 h-56 animate-pulse rounded-xl border border-border bg-surface" />
    </div>
  );
}
