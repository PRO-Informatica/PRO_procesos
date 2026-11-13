import { formatProgrammingStatus } from "../formatters";
import { PROGRAMMING_COLOR_STATES, programmingColorVariables } from "../status-colors";

export function ProgrammingStatusLegend({ residentView = false }: { residentView?: boolean }) {
  const statuses = PROGRAMMING_COLOR_STATES.filter((status) => !residentView || status !== "COMPLETED");
  return (
    <section aria-label="Guía Estados" className="mb-3 rounded-xl border border-border bg-surface p-3.5 sm:p-4">
      <h2 className="text-sm font-semibold text-foreground">Guía Estados</h2>
      <ul className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3 ${residentView ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}>
        {statuses.map((status) => (
          <li key={status} className="flex min-w-0 items-center gap-2 font-medium text-foreground">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-foreground-muted/60" style={{ backgroundColor: programmingColorVariables(status, residentView).main }} />
            <span>{formatProgrammingStatus(status, residentView)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
        {residentView ? (
          <><strong className="font-medium">Despacho completo:</strong> terminó la operación y el registro del despacho. Vencido es una alerta y permite iniciar el despacho.</>
        ) : (
          <><strong className="font-medium">Pendiente de conciliación:</strong> terminó la operación y faltan conciliaciones. <strong className="font-medium">Completado:</strong> Producto y Servicio requeridos están conciliados; Concreto directo conserva su excepción de Servicio. Vencido es una alerta y permite iniciar el despacho.</>
        )}
      </p>
    </section>
  );
}
