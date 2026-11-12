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
