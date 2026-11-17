import type { BatchStatus, ProgrammingStatus } from "./types";
import { formatStatusLabel } from "../../lib/status-labels.ts";

const activityLabels: Record<string, string> = {
  DISPATCH_SAVED: "Despacho guardado",
  DISPATCH_STARTED: "Despacho iniciado",
  DISPATCH_COMPLETED: "Despacho finalizado",
  DISPATCH_CANCELLED_WITH_PROGRAMMING: "Despacho cancelado con su programación",
  DISPATCH_RESULT_CHANGED: "Resultado del despacho actualizado",
  DISPATCH_ADDED_TO_BATCH: "Despacho agregado al lote",
  DISPATCH_REMOVED_FROM_BATCH: "Despacho retirado del lote",
  DISPATCH_DOCUMENT_PREPARED: "Carga de evidencia del despacho preparada",
  DISPATCH_DOCUMENT_REMOVED: "Evidencia del despacho eliminada",
  DISPATCH_GUIDE_ADDED: "Guía agregada al despacho",
  DISPATCH_GUIDE_UPDATED: "Guía actualizada",
  DISPATCH_GUIDE_DELETED: "Guía eliminada",
  DISPATCH_GUIDE_DETAILS_UPDATED: "Datos de la guía actualizados",
  DISPATCH_GUIDE_OCR_REVIEWED: "Lectura OCR de la guía revisada",
  DISPATCH_GUIDE_RESIDENT_REVIEWED: "Registro del residente actualizado",
  DISPATCH_INCIDENT_REPORTED: "Incidencia del despacho registrada",
  DISPATCH_INVOICE_PROCESSED: "Factura del despacho procesada",
  DISPATCH_INVOICES_RECONCILED: "Facturas de Producto y Servicio conciliadas",
  DISPATCH_RECONCILED: "Producto del despacho conciliado",
  DISPATCH_SERVICE_RECONCILED: "Servicio del despacho conciliado",
  DISPATCH_RECONCILIATION_REOPENED: "Conciliación del despacho reabierta",
  DISPATCH_REINVOICING_REQUESTED: "Refacturación de Producto solicitada",
  DISPATCH_SERVICE_REINVOICING_REQUESTED: "Refacturación de Servicio solicitada",
  GUIDE_CATALOG_WARNING: "Producto o servicio fuera de la cotización registrado",
  GUIDE_ADDED_TO_BATCH: "Guía agregada al lote",
  GUIDE_REMOVED_FROM_BATCH: "Guía retirada del lote",
  GUIDE_ROLLED_TO_WEEKLY_BATCH: "Guía trasladada al siguiente lote semanal",
  GUIDE_DOCUMENT_PREPARED: "Carga de imagen de la guía preparada",
  GUIDE_CORRECTED: "Guía corregida",
  GUIDE_ORDER_NUMBER_CORRECTED: "Número de pedido de la guía corregido",
  INCIDENT_DOCUMENT_PREPARED: "Carga de evidencia de incidencia preparada",
  PROGRAMMING_CREATED: "Programación creada",
  PROGRAMMING_UPDATED: "Programación actualizada",
  PROGRAMMING_CONFIRMED: "Programación confirmada",
  PROGRAMMING_AUTO_CONFIRMED: "Programación confirmada automáticamente",
  PROGRAMMING_CANCELLED: "Programación cancelada",
  PROGRAMMING_COMPLETED: "Programación completada",
  PROGRAMMING_AUTO_COMPLETED: "Programación completada automáticamente",
  PROGRAMMING_RETURNED_TO_DRAFT: "Programación devuelta a borrador",
  PROGRAMMING_SUBMITTED_FOR_CONFIRMATION: "Programación enviada a confirmación",
  BATCH_CREATED: "Lote creado",
  WEEKLY_BATCH_CLOSED: "Lote semanal cerrado",
  WEEKLY_BATCH_ENSURED: "Lote semanal preparado",
  WEEKLY_BATCH_ROLLOVER_COMPLETED: "Traslado al siguiente lote completado",
  ALL_DISPATCH_ORDERS_MATCHED: "Todos los pedidos del despacho conciliados",
  ORDER_COMPLETED: "Pedido completado",
  ORDER_DOCUMENTATION_CLOSED: "Documentación del pedido cerrada",
  ORDER_RECONCILIATION_RECALCULATED: "Conciliación del pedido recalculada",
  RECONCILIATION_MATCHED: "Conciliación completada",
  INVOICE_ASSIGNED_TO_ORDER: "Factura asignada al pedido",
  INVOICE_REPLACEMENT_ASSIGNED_TO_ORDER: "Factura de reemplazo asignada al pedido",
  INVOICE_REPLACED: "Factura reemplazada",
  INVOICE_RECONCILED: "Factura conciliada",
  INVOICE_RECONCILIATION_PENDING: "Factura pendiente de conciliación",
  INVOICE_EXTRACTION_CONFIRMED: "Datos extraídos de la factura confirmados",
  INVOICE_EXTRACTION_CORRECTED: "Datos extraídos de la factura corregidos",
  INVOICE_UPLOAD_PREPARED: "Carga de factura preparada",
  INVOICE_RECIPIENT_EXCEPTION_CREATED: "Excepción de destinatario de factura registrada",
  INVOICE_RECIPIENT_EXCEPTION_APPROVED: "Excepción de destinatario de factura aprobada",
  INVOICE_RECIPIENT_EXCEPTION_REINVOICE_REQUESTED: "Refacturación por destinatario solicitada",
  MIXTO_LISTO_INVOICE_EXTRACTION_CONFIRMED: "Datos de factura de Mixto Listo confirmados",
  MIXTO_LISTO_INVOICE_EXTRACTION_CORRECTED: "Datos de factura de Mixto Listo corregidos",
  MIXTO_LISTO_INVOICE_INTAKE_DISCARDED: "Carga de factura de Mixto Listo descartada",
  MIXTO_LISTO_INVOICE_PDF_UPLOADED: "PDF de factura de Mixto Listo cargado",
  MIXTO_LISTO_INVOICE_UPLOAD_PREPARED: "Carga de factura de Mixto Listo preparada",
  SERVICE_INVOICE_CONFIRMED: "Factura de Servicio confirmada",
  SERVICE_INVOICE_UPLOAD_PREPARED: "Carga de factura de Servicio preparada",
  COMPANY_DISABLED: "Empresa desactivada",
  COMPANY_MEMBERSHIP_CREATED: "Membresía de empresa creada",
  COMPANY_MEMBERSHIP_DISABLED: "Membresía de empresa desactivada",
  COMPANY_ROLE_ASSIGNED: "Rol de empresa asignado",
  COMPANY_ROLE_REVOKED: "Rol de empresa revocado",
  COMPANY_STATUS_BACKFILL: "Estado histórico de empresa actualizado",
  PLATFORM_PROJECT_CREATED: "Proyecto creado",
  PLATFORM_PROJECT_UPDATED: "Proyecto actualizado",
  PROJECT_BILLING_IDENTITY_UPDATED: "Datos de facturación del proyecto actualizados",
  PROJECT_DISABLED_WITH_COMPANY: "Proyecto desactivado con su empresa",
  PROJECT_SUPPLIERS_UPDATED: "Proveedores del proyecto actualizados",
  PROJECT_WORKSITE_ADDRESSES_UPDATED: "Direcciones de obra del proyecto actualizadas",
  USER_PROFILE_UPDATED: "Perfil de usuario actualizado",
  DISPATCH_REGISTERED: "Despacho registrado",
  GUIDE_WEEKLY_BATCH_ROLLOVER: "Guía trasladada al lote siguiente",
  INVOICE_AUTO_MATCH_APPROVED: "Factura aprobada automáticamente",
  INVOICE_SENT_TO_REINVOICING: "Factura enviada a refacturación",
  PROJECT_MEMBERSHIP_CREATED: "Membresía de proyecto creada",
  PROJECT_MEMBERSHIP_DISABLED: "Membresía de proyecto desactivada",
  PROJECT_MEMBERSHIP_REACTIVATED: "Membresía de proyecto reactivada",
  PROJECT_ROLE_ASSIGNED: "Rol de proyecto asignado",
  PROJECT_ROLE_REVOKED: "Rol de proyecto revocado",
  WEEKLY_BATCH_CLOSED_AFTER_ROLLOVER: "Lote semanal cerrado",
};

function normalizeIntlOutput(value: string) {
  return value
    .replace(/[\u00a0\u202f]/gu, " ")
    .replace(/[\u200e\u200f]/gu, "");
}

export function formatProgrammingStatus(status: ProgrammingStatus) {
  return formatStatusLabel(status);
}

export function formatBatchStatus(status: BatchStatus) {
  return formatStatusLabel(status);
}

export function formatDashboardActivity(action: string) {
  const code = action.trim().replace(/[\s-]+/gu, "_").toUpperCase();
  // Unknown audit codes stay in the audit trail, never as English UI text.
  return activityLabels[code] ?? "Actividad registrada";
}

export function formatQuantity(value: number) {
  return normalizeIntlOutput(
    new Intl.NumberFormat("es-GT", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value),
  );
}

export function formatDashboardTime(value: string, timezone: string) {
  return normalizeIntlOutput(
    new Intl.DateTimeFormat("es-GT", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(new Date(value)),
  );
}

export function formatDashboardDateTime(value: string, timezone: string) {
  return normalizeIntlOutput(
    new Intl.DateTimeFormat("es-GT", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value)),
  );
}

export function formatDateRange(start: string, end: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
  return normalizeIntlOutput(
    `${formatter.format(new Date(`${start}T12:00:00Z`))} – ${formatter.format(
      new Date(`${end}T12:00:00Z`),
    )}`,
  );
}

export function formatAccountingPeriod(value: string, timezone: string) {
  return normalizeIntlOutput(
    new Intl.DateTimeFormat("es-GT", {
      month: "long",
      year: "numeric",
      timeZone: timezone,
    }).format(new Date(`${value}T12:00:00Z`)),
  );
}
