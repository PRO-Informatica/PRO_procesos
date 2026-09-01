import type { DispatchResult, DispatchStatus } from "./types";
import { formatStatusLabel } from "@/lib/status-labels";

export function formatDispatchStatus(status: DispatchStatus) {
  return formatStatusLabel(status);
}

export function formatDispatchResult(result: DispatchResult | null) {
  return formatStatusLabel(result, "Sin resultado");
}

export function dispatchStatusTone(status: DispatchStatus) {
  if (status === "REQUIRES_CORRECTION") {
    return "bg-destructive-soft text-destructive";
  }
  if (status === "CLOSED" || status === "RECONCILED") {
    return "bg-success-soft text-success";
  }
  if (status === "BATCHED" || status === "UNDER_REVIEW") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/55 dark:text-amber-300";
  }
  return "bg-sky-100 text-sky-800 dark:bg-sky-950/55 dark:text-sky-300";
}

export function dispatchResultTone(result: DispatchResult | null) {
  if (result === "COMPLETE") return "bg-success-soft text-success";
  if (result === "PARTIAL") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/55 dark:text-amber-300";
  }
  if (result === "RETURNED" || result === "REJECTED" || result === "CANCELLED") {
    return "bg-destructive-soft text-destructive";
  }
  return "bg-muted text-foreground-muted";
}

export function formatDispatchQuantity(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(value);
}

export function formatDispatchDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatDispatchDateTime(value: string | null, timezone: string) {
  if (!value) return "No registrado";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  })
    .format(new Date(value))
    .replace(/\s+/gu, " ")
    .trim();
}

export function formatIdentifier(prefix: string, id: string) {
  return `${prefix}-${id.slice(0, 8).toUpperCase()}`;
}
