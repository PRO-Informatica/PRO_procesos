import { normalizeBusinessIdentity } from "../../lib/business-identity.ts";

export const CSAL_COMPANY_CODE = "PRO-CSAL";

const C14_IDENTITIES = new Set([
  "C14",
  "CONSTRUCTORACATORCE",
  "CONSTRUCTORACATORCESA",
]);

export const C14_EXCEPTION_MESSAGE =
  "La factura corresponde al proyecto y pedido, pero fue emitida a nombre de C14. Compras debe aceptar la excepción o solicitar refacturación.";

export type InvoiceRecipientPolicy = {
  detectedIdentity: string | null;
  isC14: boolean;
  allowed: boolean;
  requiresSocietyException: boolean;
  requiresReinvoicing: boolean;
  reason: "C14_EXCEPTION_REQUIRES_REVIEW" | null;
};

export function isC14BillingIdentity(value: string | null | undefined) {
  const normalized = normalizeBusinessIdentity(value);
  return normalized !== null && C14_IDENTITIES.has(normalized);
}

export function evaluateInvoiceRecipientPolicy(input: {
  billingLegalName: string | null | undefined;
  companyCode: string | null | undefined;
}): InvoiceRecipientPolicy {
  const detectedIdentity = normalizeBusinessIdentity(input.billingLegalName);
  const isC14 = detectedIdentity !== null && C14_IDENTITIES.has(detectedIdentity);
  const isCsal = input.companyCode?.trim().toUpperCase() === CSAL_COMPANY_CODE;
  const requiresSocietyException = isC14 && !isCsal;

  return {
    detectedIdentity,
    isC14,
    // The PDF may enter the pipeline. Purchasing decides the fiscal exception
    // separately from the Product reconciliation result.
    allowed: true,
    requiresSocietyException,
    requiresReinvoicing: false,
    reason: requiresSocietyException ? "C14_EXCEPTION_REQUIRES_REVIEW" : null,
  };
}
