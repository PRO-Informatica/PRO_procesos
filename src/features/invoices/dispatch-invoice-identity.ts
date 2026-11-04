import { classifyInvoiceLine, type ClassifiableInvoiceLine } from "./invoice-classification.ts";

export type DispatchProductIdentity = { code: string; reference: string };
export type DispatchInvoiceIdentity = {
  expectedProducts: DispatchProductIdentity[];
  productInvoicePca: string | null;
  productInvoiceIdentityValid: boolean;
};

export function normalizeProductIdentity(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
}

export function normalizeFullPca(value: string | null | undefined) {
  const match = value?.trim().toUpperCase().match(/^PCA-(\d{8})-(\d+)$/u);
  return match ? `PCA-${match[1]}-${match[2].replace(/^0+(?=\d)/u, "")}` : null;
}

export function sameFullPca(left: string | null, right: string | null) {
  const normalized = normalizeFullPca(left);
  return normalized !== null && normalized === normalizeFullPca(right);
}

export function matchInvoiceProducts(
  lines: ClassifiableInvoiceLine[],
  expected: DispatchProductIdentity[],
): "MATCH" | "MISMATCH" | "UNVERIFIABLE" {
  const products = lines.filter((line) => classifyInvoiceLine(line).product);
  if (!products.length || !expected.length || expected.some((item) => !item.code || !item.reference)) return "UNVERIFIABLE";
  return products.every((line) => expected.some((item) => {
    const reference = normalizeProductIdentity(item.reference);
    const description = normalizeProductIdentity(line.description);
    return normalizeProductIdentity(line.code) === normalizeProductIdentity(item.code)
      && (description === reference || description.startsWith(`${reference} `));
  })) ? "MATCH" : "MISMATCH";
}

export function dispatchProducts(
  guideLines: Array<{ catalog_type: string | null; product_code: string | null; catalog_reference: string | null }>,
  programmingReferences: Array<string | null>,
  catalog: Array<{ code: string; reference: string }>,
): DispatchProductIdentity[] {
  const products = guideLines.filter((line) => line.catalog_type === "PRODUCT");
  // Prefer the identity actually applied to the guides, not today's catalog price.
  if (products.length) {
    if (products.some((line) => !line.product_code?.trim() || !line.catalog_reference?.trim())) return [];
    return products.map((line) => ({ code: line.product_code!, reference: line.catalog_reference! }));
  }
  // Historical guides may have free labels. Only use a unique, exact catalog
  // reference from their programming; never infer PSI or invent a product code.
  if (!programmingReferences.length || programmingReferences.some((reference) => !reference?.trim())) return [];
  const matches = programmingReferences.map((reference) => catalog.filter((item) =>
    normalizeProductIdentity(item.reference) === normalizeProductIdentity(reference),
  ));
  return matches.every((items) => items.length === 1) ? matches.map((items) => items[0]) : [];
}
