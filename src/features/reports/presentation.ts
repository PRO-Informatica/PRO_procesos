import type { BadgeTone } from "@/components/ui/badge";

export function reportDispatchProcessStatus(
  dispatchStatus: string,
  reconciliationStatus: string | null,
  billingComplete = false,
) {
  if (dispatchStatus !== "COMPLETED") return dispatchStatus;
  if (billingComplete) return "COMPLETED";
  if (reconciliationStatus === "RECONCILED") return "PENDING_RECONCILIATION";
  return reconciliationStatus || "NOT_STARTED";
}

export function reportStatusTone(status: string): BadgeTone {
  if (status === "COMPLETED") return "completed";
  if (["RECONCILED", "CONFIRMED", "REGISTERED"].includes(status)) return "success";
  if (["WITH_DIFFERENCES", "PENDING_REINVOICING"].includes(status)) return "warning";
  if (["CANCELLED", "NON_PROCEEDING"].includes(status)) return "danger";
  if (["IN_EXECUTION", "PENDING_RECONCILIATION"].includes(status)) return "info";
  return "neutral";
}
