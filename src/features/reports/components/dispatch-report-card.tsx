import { FileText } from "lucide-react";
import { StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { formatStatusLabel } from "@/lib/status-labels";
import { reportDispatchProcessStatus } from "../presentation";
import type { DispatchReportSummary } from "../types";
import { ProjectScopedReportLink } from "./project-scoped-report-link";

function quantity(value: number) { return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(value); }
function money(value: number, currency: string) { return new Intl.NumberFormat("es-GT", { style: "currency", currency, minimumFractionDigits: 2 }).format(value); }

function statusTone(status: string): BadgeTone {
  if (status === "COMPLETED") return "completed";
  if (["RECONCILED", "CONFIRMED", "REGISTERED"].includes(status)) return "success";
  if (["WITH_DIFFERENCES", "PENDING_REINVOICING"].includes(status)) return "warning";
  if (["CANCELLED", "NON_PROCEEDING"].includes(status)) return "danger";
  if (["IN_EXECUTION", "PENDING_RECONCILIATION"].includes(status)) return "info";
  return "neutral";
}

function InvoiceLine({ label, invoice }: { label: string; invoice: DispatchReportSummary["productInvoice"] }) {
  return <div className="grid min-w-0 gap-2 rounded-lg border border-border/80 bg-background/55 px-3 py-2.5 min-[390px]:grid-cols-[minmax(0,1fr)_auto] min-[390px]:items-center"><div className="flex min-w-0 items-center gap-2.5"><span className={`grid size-7 shrink-0 place-items-center rounded-md ${invoice ? "bg-success-soft text-success" : "bg-muted text-foreground-muted"}`}><FileText className="size-3.5" /></span><div className="min-w-0"><p className="text-[11px] font-medium text-foreground-muted">{label}</p><p className="truncate text-sm font-semibold text-foreground">{invoice?.number ?? "Pendiente"}</p></div></div>{invoice && <div className="pl-9 text-left min-[390px]:pl-0 min-[390px]:text-right"><p className="text-xs font-semibold text-foreground">{money(invoice.total, invoice.currency)}</p><p className="text-[10px] text-foreground-muted">{formatStatusLabel(invoice.extractionStatus, "Sin extracción")}</p></div>}</div>;
}

export function DispatchReportCard({ dispatch, selection, context }: { dispatch: DispatchReportSummary; selection?: React.ReactNode; context?: React.ReactNode }) {
  const processStatus = reportDispatchProcessStatus(
    dispatch.dispatchStatus,
    dispatch.reconciliationStatus,
    dispatch.billingComplete,
  );

  return <section className="rounded-xl border border-border bg-background/40 p-4 sm:p-5"><div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2">{selection}<ProjectScopedReportLink projectId={dispatch.projectId} href={`/dispatches/${dispatch.dispatchId}`} className="font-mono text-sm font-semibold text-brand-strong hover:underline disabled:cursor-wait disabled:opacity-60">{dispatch.dispatchCode}</ProjectScopedReportLink><StatusBadge label={formatStatusLabel(processStatus)} tone={statusTone(processStatus)} /></div>{context}<div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-3"><div><p className="text-foreground-muted">Pedido</p><p className="mt-0.5 font-semibold text-foreground">{dispatch.orderNumber ?? "Sin pedido"}</p></div><div><p className="text-foreground-muted">Lote</p><p className="mt-0.5 font-semibold text-foreground">{dispatch.batchCode ?? "Sin lote"}</p></div><div><p className="text-foreground-muted">Volumen real</p><p className="mt-0.5 font-semibold text-foreground">{quantity(dispatch.receivedQuantity)} {dispatch.unitCode}</p></div><div><p className="text-foreground-muted">Guías</p><p className="mt-0.5 font-semibold text-foreground">{dispatch.guideCount}</p></div><div><p className="text-foreground-muted">Incidencias</p><p className="mt-0.5 font-semibold text-foreground">{dispatch.incidentCount}</p></div><div><p className="text-foreground-muted">Elemento a fundir</p><p className="mt-0.5 font-semibold text-foreground">{dispatch.castingElementLabel}</p></div><div className="min-w-0"><p className="text-foreground-muted">Camión</p><p className="mt-0.5 break-words font-semibold text-foreground">{dispatch.trucks.join(", ") || "Sin registrar"}</p></div><div><p className="text-foreground-muted">Se aplicó laboratorio</p><p className="mt-0.5 font-semibold text-foreground">{dispatch.laboratoryLabel}</p></div><div className="min-w-0 rounded-lg bg-success-soft p-2 text-success"><p>Validado por</p><p className="mt-0.5 break-words font-semibold">{dispatch.completedByName ?? (dispatch.dispatchStatus === "COMPLETED" ? "No registrado" : "Pendiente")}</p></div></div></div><div className="grid min-w-0 gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.1em] text-foreground-muted">Conciliación de Producto</p><div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge label={formatStatusLabel(dispatch.reconciliationStatus)} tone={statusTone(dispatch.reconciliationStatus)} dot /><span className="text-xs text-foreground-muted">Diferencia: <strong className={dispatch.difference === 0 ? "text-success" : "text-destructive"}>{quantity(dispatch.difference)} {dispatch.unitCode}</strong></span></div></div><div className="grid min-w-0 gap-2"><InvoiceLine label="Factura de producto" invoice={dispatch.productInvoice} /><InvoiceLine label="Factura de servicio" invoice={dispatch.serviceInvoice} /></div><ProjectScopedReportLink projectId={dispatch.projectId} href={`/dispatches/${dispatch.dispatchId}`} className="secondary-button w-full text-xs disabled:cursor-wait disabled:opacity-60 xl:w-auto">Ver despacho</ProjectScopedReportLink></div></div></section>;
}
