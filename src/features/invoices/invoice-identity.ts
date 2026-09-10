import { normalizeTaxIdentity } from "../../lib/business-identity.ts";

export function normalizeFiscalComponent(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

export function buildFiscalDocumentKey(input: {
  issuerTaxId: string | null | undefined;
  authorizationNumber: string | null | undefined;
  series: string | null | undefined;
  invoiceNumber: string | null | undefined;
}) {
  const issuer = normalizeTaxIdentity(input.issuerTaxId);
  if (!issuer) return null;

  const authorization = normalizeFiscalComponent(input.authorizationNumber);
  if (authorization) return `${issuer}:AUTH:${authorization}`;

  const series = normalizeFiscalComponent(input.series);
  const invoiceNumber = normalizeFiscalComponent(input.invoiceNumber);
  if (!series || !invoiceNumber) return null;
  return `${issuer}:SERIES:${series}:NUMBER:${invoiceNumber}`;
}
