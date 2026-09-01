import type { BatchStatus, ProgrammingStatus } from "./types";
import { formatStatusLabel, humanizeInternalCode } from "@/lib/status-labels";

const activityLabels: Record<string, string> = {
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

export function formatProgrammingStatus(status: ProgrammingStatus) {
  return formatStatusLabel(status);
}

export function formatBatchStatus(status: BatchStatus) {
  return formatStatusLabel(status);
}

export function formatDashboardActivity(action: string) {
  return activityLabels[action] ?? humanizeInternalCode(action);
}

export function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-GT", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatDashboardTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-GT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatDashboardDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatDateRange(start: string, end: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
  return `${formatter.format(new Date(`${start}T12:00:00Z`))} – ${formatter.format(
    new Date(`${end}T12:00:00Z`),
  )}`;
}

export function formatAccountingPeriod(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-GT", {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(`${value}T12:00:00Z`));
}
