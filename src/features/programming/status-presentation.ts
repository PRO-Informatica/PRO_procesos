import { hasUniversalOperationalViewRole } from "../projects/access-policy";
import {
  PROGRAMMING_VISIBLE_STATUSES,
  type ProgrammingEffectiveStatus,
  type ProgrammingFilters,
} from "./types";

export function usesResidentProgrammingView(roleCodes: string[]) {
  return roleCodes.includes("RESIDENT") && !hasUniversalOperationalViewRole(roleCodes);
}

// Display only: keep the original status for permissions, actions and persistence.
export function getProgrammingDisplayStatus(
  status: ProgrammingEffectiveStatus,
  residentView = false,
): ProgrammingEffectiveStatus {
  return residentView && status === "COMPLETED" ? "DISPATCH_COMPLETED" : status;
}

export function getProgrammingVisibleStatuses(residentView = false) {
  return PROGRAMMING_VISIBLE_STATUSES.filter((status) => !residentView || status !== "COMPLETED");
}

export function getProgrammingRequestFilters(filters: ProgrammingFilters, residentView = false): ProgrammingFilters {
  // This display group includes two database states; fetch both and filter in the view.
  if (residentView && filters.status && getProgrammingDisplayStatus(filters.status, true) === "DISPATCH_COMPLETED") {
    return { ...filters, status: undefined };
  }
  return filters;
}
