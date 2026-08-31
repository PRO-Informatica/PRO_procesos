import type { ProgrammingStatus } from "./types";

export const programmingStatusLabels: Record<ProgrammingStatus, string> = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  CONFIRMED: "Confirmada",
  IN_EXECUTION: "En ejecución",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export function formatProgrammingStatus(status: ProgrammingStatus) {
  return programmingStatusLabels[status];
}

export function programmingStatusTone(status: ProgrammingStatus) {
  const tones: Record<ProgrammingStatus, string> = {
    DRAFT: "bg-muted text-foreground-muted",
    PENDING_CONFIRMATION: "bg-amber-100 text-amber-800 dark:bg-amber-950/55 dark:text-amber-300",
    CONFIRMED: "bg-blue-100 text-blue-800 dark:bg-blue-950/55 dark:text-blue-300",
    IN_EXECUTION: "bg-brand-soft text-brand-strong",
    COMPLETED: "bg-success-soft text-success",
    CANCELLED: "bg-destructive-soft text-destructive",
  };
  return tones[status];
}

export function formatProgrammingQuantity(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("es-GT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatProgrammingDateTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dayPeriod = get("dayPeriod").replace(/\s+/gu, " ").trim();
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")} ${dayPeriod}`.trim();
}

export function formatProgrammingDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-GT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  })
    .format(new Date(value))
    .replace(/\s+/gu, " ")
    .trim();
}

export function formatProgrammingTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("es-GT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}
