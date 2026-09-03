import type { BatchStatus } from "./types";
import { formatStatusLabel } from "@/lib/status-labels";

export function formatBatchStatus(status: BatchStatus) {
  return formatStatusLabel(status);
}

export function batchStatusTone(status: BatchStatus) {
  if (status === "CLOSED") {
    return "bg-success-soft text-success";
  }
  return "bg-sky-100 text-sky-800 dark:bg-sky-950/55 dark:text-sky-300";
}

export function formatBatchDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeZone: "UTC",
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace(/[\u00a0\u202f]/g, " ");
}

export function formatBatchDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  })
    .format(new Date(value))
    .replace(/[\u00a0\u202f]/g, " ");
}

export function formatBatchQuantity(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(
    value,
  );
}

export function formatProgrammingCode(id: string) {
  return `PRG-${id.slice(0, 8).toUpperCase()}`;
}
