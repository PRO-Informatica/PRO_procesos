import { Eye } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { formatDispatchDateTime, formatDispatchMoney, formatDispatchQuantity } from "@/features/dispatches/formatters";
import { formatStatusLabel } from "@/lib/status-labels";

import { reportDispatchProcessStatus, reportStatusTone } from "../presentation";
import type { DispatchReportSummary } from "../types";
import { ProjectScopedReportLink } from "./project-scoped-report-link";
import styles from "./report-results-table.module.css";

function ReportStatus({ status, dot }: { status: string; dot?: boolean }) {
  const tone = reportStatusTone(status);
  return <Badge tone={tone} dot={dot} className={styles[tone]}>{formatStatusLabel(status)}</Badge>;
}

function InvoiceCells({ invoice }: { invoice: DispatchReportSummary["productInvoice"] }) {
  return (
    <>
      <td>{invoice?.number ?? "Pendiente"}</td>
      <td className={styles.numeric}>{invoice ? formatDispatchMoney(invoice.total, invoice.currency) : "—"}</td>
      <td>{invoice ? formatStatusLabel(invoice.extractionStatus, "Sin extracción") : "—"}</td>
    </>
  );
}

export function DispatchTableRow({ dispatch, selection }: { dispatch: DispatchReportSummary; selection?: ReactNode }) {
  const status = reportDispatchProcessStatus(dispatch.dispatchStatus, dispatch.reconciliationStatus, dispatch.billingComplete);
  const service = dispatch.serviceReconciliation;
  const validator = dispatch.completedByName ?? (dispatch.dispatchStatus === "COMPLETED" ? "No registrado" : "Pendiente");
  return (
    <tr>
      {selection && <td className={styles.selection}>{selection}</td>}
      <th scope="row" className={styles.identifier}>{dispatch.dispatchCode}</th>
      <td>{dispatch.orderNumber ?? "Sin pedido"}</td>
      <td><ReportStatus status={status} /></td>
      <td><ReportStatus status={dispatch.reconciliationStatus} dot /></td>
      <td>
        {service
          ? <ReportStatus status={service.status} dot />
          : <span className="text-foreground-muted">No requerido</span>}
      </td>
      <td className={styles.numeric}>{formatDispatchQuantity(dispatch.receivedQuantity)} {dispatch.unitCode}</td>
      <td className={styles.numeric}>{formatDispatchQuantity(dispatch.difference)} {dispatch.unitCode}</td>
      <td className={styles.numeric}>{service && service.difference !== null ? formatDispatchMoney(service.difference, service.currency) : "—"}</td>
      <td className={styles.description}>{dispatch.projectName}</td>
      <td className={styles.description}>{dispatch.supplierName}</td>
      <td><time dateTime={dispatch.scheduledAt}>{formatDispatchDateTime(dispatch.scheduledAt, dispatch.timezone)}</time></td>
      <td className={styles.identifier}>{dispatch.programmingCode}</td>
      <td className={styles.description}>{dispatch.companyName}</td>
      <td>{dispatch.batchCode ?? "Sin lote"}</td>
      <InvoiceCells invoice={dispatch.productInvoice} />
      <InvoiceCells invoice={dispatch.serviceInvoice} />
      <td className={styles.numeric}>{dispatch.guideCount}</td>
      <td className={styles.numeric}>{dispatch.incidentCount}</td>
      <td className={styles.description}>{dispatch.castingElementLabel}</td>
      <td className={styles.description}>{dispatch.trucks.join(", ") || "Sin registrar"}</td>
      <td>{dispatch.laboratoryLabel}</td>
      <td className={styles.description}><span className={dispatch.completedByName ? "font-semibold text-success" : "text-foreground-muted"}>{validator}</span></td>
      <td>
        <ProjectScopedReportLink projectId={dispatch.projectId} href={`/dispatches/${dispatch.dispatchId}`} className={styles.action} title="Ver despacho">
          <span className="sr-only">Ver despacho {dispatch.dispatchCode}</span>
          <Eye aria-hidden="true" className="size-4" />
        </ProjectScopedReportLink>
      </td>
    </tr>
  );
}
