import Link from "next/link";

export function ReportSections({ universal = false, radar = false }: { universal?: boolean; radar?: boolean }) {
  return (
    <nav aria-label="Secciones de reportería" className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-2">
      <Link href={universal ? "/reports/universal" : "/reports"} aria-current={!radar ? "page" : undefined} className={!radar ? "primary-button" : "secondary-button"}>Reporte general</Link>
      <Link href={`/reports/radar${universal ? "?scope=universal" : ""}`} aria-current={radar ? "page" : undefined} className={radar ? "primary-button" : "secondary-button"}>Radar de fundición</Link>
    </nav>
  );
}
