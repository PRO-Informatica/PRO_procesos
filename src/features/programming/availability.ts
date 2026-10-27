import type {
  ProgrammingEffectiveStatus,
  ProgrammingStatus,
} from "./types";

export type ProgrammingAvailabilityInput = {
  status: ProgrammingStatus;
  scheduledAt: string;
  operationStarted: boolean;
  timezone?: string;
  version?: number;
};

export type ProgrammingScopeInput = {
  effectiveStatus: ProgrammingEffectiveStatus;
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
    !(programming.version && programming.version > 1) &&
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
  // Expiry is an informational alert; the confirmed operation remains usable.
  return ["CONFIRMED", "EXPIRED", "IN_EXECUTION"].includes(effectiveStatus);
}

export function canEditProgramming(
  programming: ProgrammingAvailabilityInput & { hasPermission: boolean },
  now = Date.now(),
) {
  void now;
  if (!programming.hasPermission || programming.operationStarted) return false;
  if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(programming.status)) {
    return false;
  }

  const scheduledAt = new Date(programming.scheduledAt);
  if (!Number.isFinite(scheduledAt.valueOf())) return false;

  return true;
}

export function canConfirmProgramming(
  programming: ProgrammingAvailabilityInput & { hasPermission: boolean },
  now = Date.now(),
) {
  if (
    !programming.hasPermission ||
    programming.operationStarted ||
    programming.status !== "PENDING_CONFIRMATION"
  ) return false;
  const timestamp = new Date(programming.scheduledAt).valueOf();
  // Versioned edits must be confirmed again, including historical schedules.
  // The database independently checks the edit revision for the exact version.
  return Number.isFinite(timestamp) &&
    (timestamp >= now || (programming.version ?? 1) > 1);
}

export function isActiveProgramming(
  programming: ProgrammingScopeInput,
) {
  void programming;
  return true;
}

export function isHistoricalProgramming(
  programming: ProgrammingScopeInput,
) {
  return programming.effectiveStatus === "COMPLETED";
}
