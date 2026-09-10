export type InvoiceUploadSlot = {
  currentInvoiceId: string | null;
  operation: "NEW" | "REINVOICE";
  occupied: boolean;
  replacesInvoiceId: string | null;
};

type ResolveInvoiceUploadSlotInput = {
  invoiceType: "PRODUCT" | "SERVICE";
  reconciliationStatus: string | null | undefined;
  currentProductInvoiceId: string | null | undefined;
  currentServiceInvoiceId: string | null | undefined;
};

export function resolveInvoiceUploadSlot({
  invoiceType,
  reconciliationStatus,
  currentProductInvoiceId,
  currentServiceInvoiceId,
}: ResolveInvoiceUploadSlotInput): InvoiceUploadSlot {
  const currentInvoiceId = invoiceType === "PRODUCT"
    ? currentProductInvoiceId ?? null
    : currentServiceInvoiceId ?? null;
  const replacesInvoiceId = invoiceType === "PRODUCT" &&
      reconciliationStatus === "PENDING_REINVOICING"
    ? currentProductInvoiceId ?? null
    : null;

  return {
    currentInvoiceId,
    operation: replacesInvoiceId ? "REINVOICE" : "NEW",
    occupied: Boolean(currentInvoiceId) && !replacesInvoiceId,
    replacesInvoiceId,
  };
}
