import { SkeletonTable } from "@/components/feedback/skeletons";

export default function PlatformUsersLoading() {
  return (
    <div className="mx-auto max-w-[1440px]" aria-label="Cargando usuarios">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-border/75" />
      <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-border/60" />
      <div className="mt-6 h-20 animate-pulse rounded-xl border border-border bg-surface" />
      <div className="mt-4">
        <SkeletonTable rows={7} />
      </div>
    </div>
  );
}
