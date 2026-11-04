import { formatProgrammingStatus } from "../formatters";
import type { ProgrammingEffectiveStatus } from "../types";

// Swatches match the calendar's main colors; labels do not rely on color alone.
const entries: Array<{ status: ProgrammingEffectiveStatus; color: string }> = [
  { status: "CONFIRMED", color: "#2563eb" },
  { status: "IN_EXECUTION", color: "#ca8a04" },
  { status: "DISPATCH_COMPLETED", color: "#16a34a" },
  { status: "COMPLETED", color: "#7c3aed" },
  { status: "CANCELLED", color: "#b42318" },
  { status: "EXPIRED", color: "#64748b" },
];

export function ProgrammingStatusLegend() {
  return (
    <section aria-label="Guía Estados" className="mb-3 rounded-xl border border-border bg-surface p-3.5 sm:p-4">
      <h2 className="text-sm font-semibold text-foreground">Guía Estados</h2>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3 xl:grid-cols-6">
        {entries.map(({ status, color }) => (
          <li key={status} className="flex min-w-0 items-center gap-2 font-medium text-foreground">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span>{formatProgrammingStatus(status)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
        <strong className="font-medium">Despacho completo:</strong> terminó la operación. <strong className="font-medium">Completado:</strong> la programación ya está cerrada. Vencido es una alerta y permite iniciar el despacho.
      </p>
    </section>
  );
}
