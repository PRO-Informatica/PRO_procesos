import type { AppEnvironment } from "@/lib/env";

export function EnvironmentBadge({ environment }: { environment: AppEnvironment }) {
  if (environment !== "DEV") return null;

  return (
    <div
      aria-label="Ambiente de desarrollo"
      className="pointer-events-none fixed bottom-2 left-2 z-50 rounded-full border border-amber-300/70 bg-amber-50/95 px-2 py-1 text-[10px] font-bold tracking-[0.16em] text-amber-800 shadow-sm backdrop-blur-sm dark:border-amber-700/70 dark:bg-amber-950/90 dark:text-amber-200"
    >
      DEV
    </div>
  );
}
