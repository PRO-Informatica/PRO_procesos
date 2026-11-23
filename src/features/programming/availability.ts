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
  if (!programming.hasPermission || programming.operationStarted) return false;
  const effectiveStatus = getEffectiveProgrammingStatus(programming, now);
  // Expiry is an informational alert; the confirmed operation remains usable.
  return ["CONFIRMED", "EXPIRED", "IN_EXECUTION"].includes(effectiveStatus);
}

export function canEditProgramming(
  programming: ProgrammingAvailabilityInput & { hasPermission: boolean; canEditStarted?: boolean },
  _now = Date.now(),
) {
  void _now;
  if (!programming.hasPermission || !Number.isFinite(Date.parse(programming.scheduledAt))) return false;
  if (programming.operationStarted) {
    return programming.canEditStarted === true && ["IN_EXECUTION", "DISPATCH_COMPLETED", "COMPLETED"].includes(programming.status);
  }
  return ["PENDING_CONFIRMATION", "CONFIRMED"].includes(programming.status);
}

export function canCancelProgramming(
  programming: ProgrammingAvailabilityInput & { hasPermission: boolean; hasGuides?: boolean },
  now = Date.now(),
) {
  if (programming.status === "IN_EXECUTION") {
    return programming.hasPermission && programming.hasGuides === false;
  }
  return programming.hasPermission &&
    getEffectiveProgrammingStatus(programming, now) !== "CANCELLED" &&
    ["PENDING_CONFIRMATION", "CONFIRMED"].includes(programming.status) &&
    (!programming.operationStarted || programming.hasGuides === false);
}

export function canConfirmProgramming(
  programming: ProgrammingAvailabilityInput & { hasPermission: boolean },
  now = Date.now(),
) {
  void programming;
  void now;
  return false; // Creation and authorized edits confirm atomically in the database.
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
