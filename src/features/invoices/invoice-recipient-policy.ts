import { normalizeBusinessIdentity } from "../../lib/business-identity.ts";

export const CSAL_COMPANY_CODE = "PRO-CSAL";

const C14_IDENTITIES = new Set([
  "C14",
  "CONSTRUCTORACATORCE",
  "CONSTRUCTORACATORCESA",
]);

export const C14_REINVOICING_MESSAGE =
  "La factura corresponde al proyecto por dirección y pedido, pero fue emitida a nombre de C14. Para este proyecto no se permite facturación con esa sociedad. Se requiere refacturación.";

export type InvoiceRecipientPolicy = {
  detectedIdentity: string | null;
  isC14: boolean;
  allowed: boolean;
  requiresReinvoicing: boolean;
  reason: "C14_NOT_ALLOWED_FOR_PROJECT" | null;
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
  const requiresReinvoicing = isC14 && !isCsal;

  return {
    detectedIdentity,
    isC14,
    allowed: !requiresReinvoicing,
    requiresReinvoicing,
    reason: requiresReinvoicing ? "C14_NOT_ALLOWED_FOR_PROJECT" : null,
  };
}
