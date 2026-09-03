import type {
  ProgrammingEffectiveStatus,
  ProgrammingStatus,
} from "./types";

export type ProgrammingAvailabilityInput = {
  status: ProgrammingStatus;
  scheduledAt: string;
  operationStarted: boolean;
  timezone?: string;
};

export type ProgrammingScopeInput = {
  effectiveStatus: ProgrammingEffectiveStatus;
  reconciliationStatus: string | null;
};

const DEFAULT_TIMEZONE = "America/Guatemala";

function localDateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function getEffectiveProgrammingStatus(
  programming: ProgrammingAvailabilityInput,
  now = Date.now(),
): ProgrammingEffectiveStatus {
  const scheduledAt = new Date(programming.scheduledAt).valueOf();
  const timezone = programming.timezone ?? DEFAULT_TIMEZONE;
  if (
    programming.status === "PENDING_CONFIRMATION" &&
    Number.isFinite(scheduledAt) &&
    localDateKey(new Date(scheduledAt), timezone) <
      localDateKey(new Date(now), timezone)
  ) {
    return "CANCELLED";
  }
  if (
    programming.status === "CONFIRMED" &&
    Number.isFinite(scheduledAt) &&
    scheduledAt < now &&
    !programming.operationStarted
  ) {
    return "EXPIRED";
  }
  return programming.status;
}

export function canCreateDispatchForProgramming(
  programming: ProgrammingAvailabilityInput & { hasPermission: boolean },
  now = Date.now(),
) {
  if (!programming.hasPermission) return false;
  const effectiveStatus = getEffectiveProgrammingStatus(programming, now);
  return effectiveStatus === "CONFIRMED" || effectiveStatus === "IN_EXECUTION";
}

export function isActiveProgramming(
  programming: ProgrammingScopeInput,
) {
  return (
    programming.reconciliationStatus !== "RECONCILED" &&
    programming.effectiveStatus !== "CANCELLED"
  );
}

export function isHistoricalProgramming(
  programming: ProgrammingScopeInput,
) {
  return (
    programming.reconciliationStatus === "RECONCILED" ||
    programming.effectiveStatus === "CANCELLED"
  );
}
