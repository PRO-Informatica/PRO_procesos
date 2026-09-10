export function reportDispatchProcessStatus(
  dispatchStatus: string,
  reconciliationStatus: string | null,
) {
  if (dispatchStatus !== "COMPLETED") return dispatchStatus;
  if (reconciliationStatus === "RECONCILED") return "COMPLETED";
  return reconciliationStatus || "NOT_STARTED";
}
