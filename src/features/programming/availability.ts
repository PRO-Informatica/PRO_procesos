import type {
  ProgrammingEffectiveStatus,
  ProgrammingStatus,
} from "./types";

export type ProgrammingAvailabilityInput = {
  status: ProgrammingStatus;
  scheduledAt: string;
  operationStarted: boolean;
};

export function getEffectiveProgrammingStatus(
  programming: ProgrammingAvailabilityInput,
  now = Date.now(),
): ProgrammingEffectiveStatus {
  const scheduledAt = new Date(programming.scheduledAt).valueOf();
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
  programming: ProgrammingAvailabilityInput,
  now = Date.now(),
) {
  const effectiveStatus = getEffectiveProgrammingStatus(programming, now);
  if (effectiveStatus === "IN_EXECUTION") return true;
  if (effectiveStatus === "CONFIRMED" && programming.operationStarted) {
    return true;
  }
  if (["EXPIRED", "COMPLETED", "CANCELLED"].includes(effectiveStatus)) {
    return false;
  }
  const scheduledAt = new Date(programming.scheduledAt).valueOf();
  return Number.isFinite(scheduledAt) && scheduledAt >= now;
}

export function isHistoricalProgramming(
  programming: ProgrammingAvailabilityInput,
  now = Date.now(),
) {
  return !isActiveProgramming(programming, now);
}
