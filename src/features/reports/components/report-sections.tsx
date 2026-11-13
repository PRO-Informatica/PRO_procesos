import Link from "next/link";

export function ReportSections({ universal = false, radar = false }: { universal?: boolean; radar?: boolean }) {
  const tabClassName = "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 text-center text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none sm:px-6 sm:text-sm";
  const activeClassName = "bg-brand text-white shadow-sm hover:bg-brand-strong";
  const inactiveClassName = "text-foreground-muted hover:bg-muted/70 hover:text-foreground";

  return (
    <nav aria-label="Secciones de reportería" className="mt-4 inline-flex w-full max-w-full items-center gap-1 rounded-full bg-surface p-1.5 shadow-sm sm:w-auto">
      <Link href={universal ? "/reports/universal" : "/reports"} aria-current={!radar ? "page" : undefined} className={`${tabClassName} ${!radar ? activeClassName : inactiveClassName}`}>Reporte general</Link>
      <Link href={`/reports/radar${universal ? "?scope=universal" : ""}`} aria-current={radar ? "page" : undefined} className={`${tabClassName} ${radar ? activeClassName : inactiveClassName}`}>Radar de fundición</Link>
    </nav>
  );
}
