import type { BatchStatus } from "./types";

const labels: Record<BatchStatus, string> = {
  DRAFT: "Borrador",
  ASSEMBLING: "En preparación",
  READY_FOR_REVIEW: "Listo para revisión",
  UNDER_REVIEW: "En revisión",
  NEEDS_CORRECTION: "Necesita corrección",
  VALIDATED: "Validado",
  PENDING_FINAL_AUTHORIZATION: "Pendiente de autorización final",
  AUTHORIZED: "Autorizado",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
};

export function formatBatchStatus(status: BatchStatus) {
  return labels[status] ?? status;
}

export function batchStatusTone(status: BatchStatus) {
  if (status === "NEEDS_CORRECTION" || status === "CANCELLED") {
    return "bg-destructive-soft text-destructive";
  }
  if (status === "CLOSED" || status === "AUTHORIZED" || status === "VALIDATED") {
    return "bg-success-soft text-success";
  }
  if (status === "READY_FOR_REVIEW" || status === "UNDER_REVIEW") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/55 dark:text-amber-300";
  }
  return "bg-sky-100 text-sky-800 dark:bg-sky-950/55 dark:text-sky-300";
}

export function formatBatchDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatBatchDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatBatchQuantity(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(value);
}

export function formatProgrammingCode(id: string) {
  return `PRG-${id.slice(0, 8).toUpperCase()}`;
}
