export type InvoiceUploadSlot = {
  currentInvoiceId: string | null;
  operation: "NEW" | "REINVOICE";
  occupied: boolean;
  replacesInvoiceId: string | null;
};

type ResolveInvoiceUploadSlotInput = {
  invoiceType: "PRODUCT" | "SERVICE";
  reconciliationStatus: string | null | undefined;
  serviceReconciliationStatus?: string | null;
  currentProductInvoiceId: string | null | undefined;
  currentServiceInvoiceId: string | null | undefined;
};

export function resolveInvoiceUploadSlot({
  invoiceType,
  reconciliationStatus,
  serviceReconciliationStatus,
  currentProductInvoiceId,
  currentServiceInvoiceId,
}: ResolveInvoiceUploadSlotInput): InvoiceUploadSlot {
  const currentInvoiceId = invoiceType === "PRODUCT"
    ? currentProductInvoiceId ?? null
    : currentServiceInvoiceId ?? null;
  const status = invoiceType === "PRODUCT" ? reconciliationStatus : serviceReconciliationStatus;
  const replacesInvoiceId = status === "PENDING_REINVOICING" ? currentInvoiceId : null;

  return {
    currentInvoiceId,
    operation: replacesInvoiceId ? "REINVOICE" : "NEW",
    occupied: Boolean(currentInvoiceId) && !replacesInvoiceId,
    replacesInvoiceId,
  };
}
