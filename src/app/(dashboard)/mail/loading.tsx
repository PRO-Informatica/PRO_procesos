import { SkeletonBlock } from "@/components/feedback/skeletons";

export default function MailLoading() {
  return (
    <div className="mx-auto max-w-[1500px]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando correo…</span>
      <SkeletonBlock className="h-3 w-44" />
      <SkeletonBlock className="mt-3 h-9 w-52" />
      <SkeletonBlock className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex gap-2 border-b border-border p-2">
          <SkeletonBlock className="h-10 w-28" />
          <SkeletonBlock className="h-10 w-28" />
        </div>
        <div className="grid min-h-[34rem] lg:grid-cols-[minmax(19rem,0.85fr)_minmax(0,1.5fr)]">
          <div className="divide-y divide-border border-r border-border">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="space-y-2 p-4">
                <SkeletonBlock className="h-3 w-1/3" />
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="h-3 w-full" />
              </div>
            ))}
          </div>
          <div className="hidden place-items-center lg:grid"><SkeletonBlock className="h-4 w-52" /></div>
        </div>
      </div>
    </div>
  );
}
