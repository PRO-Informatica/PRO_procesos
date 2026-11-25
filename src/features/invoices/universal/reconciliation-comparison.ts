import type { InvoiceProcessingPayload } from "../invoice-processing";
import type { ServiceReconciliationSummary } from "../service-reconciliation";
import type { MixtoListoParsedLine } from "../../batches/mixto-listo-parser";
import { classifyInvoiceLine } from "../invoice-classification.ts";

type AmountBasis = "PRODUCT_TOTAL" | "SERVICE_TOTAL" | "INVOICE_TOTAL";

export type UniversalInvoiceComparison = {
  basis: AmountBasis | "REAL_VOLUME" | "PROGRAMMED_QUANTITY";
  expected: number | null;
  invoiced: number | null;
  difference: number | null;
  expectedUnit: string | null;
  invoiceUnit: string | null;
  matches: boolean;
};

export type MixedInvoiceTotals = { product: number; service: number };
export type MixedInvoiceComparison = {
  product: UniversalInvoiceComparison;
  service: UniversalInvoiceComparison;
  total: UniversalInvoiceComparison;
};

export function storedMixedInvoiceTotals(value: unknown): MixedInvoiceTotals | null {
  if (!value || typeof value !== "object" || !("product" in value) || !("service" in value)) return null;
  return typeof value.product === "number" && typeof value.service === "number"
    && Number.isFinite(value.product) && Number.isFinite(value.service)
    && value.product >= 0 && value.service >= 0 ? { product: value.product, service: value.service } : null;
}

type PriceSnapshot = { unit_price: unknown; estimated_subtotal: unknown; currency: string | null };
const ZERO = BigInt(0), ONE = BigInt(1), HUNDRED = BigInt(100);

// Guide snapshots have four decimal places. Sum them before rounding to cents,
// just like round(sum(estimated_subtotal), 2) in reconcile_dispatch_service.
function snapshotUnits(value: unknown): bigint | null {
  const text = typeof value === "number" && Number.isFinite(value) ? value.toFixed(4) : typeof value === "string" ? value : "";
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/u.exec(text);
  if (!match) return null;
  return (match[1] ? -ONE : ONE) * (BigInt(match[2]) * BigInt(10000) + BigInt((match[3] ?? "").padEnd(4, "0")));
}

function cents(units: bigint) {
  return (units < ZERO ? -ONE : ONE) * (((units < ZERO ? -units : units) + BigInt(50)) / HUNDRED);
}

function amount(value: bigint): number | null {
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(value) / 100;
}

function moneyCents(value: number | null) {
  const units = snapshotUnits(value);
  return units === null ? null : cents(units);
}

export function splitMixedInvoiceTotals(lines: MixtoListoParsedLine[], invoiceTotal: number | null): MixedInvoiceTotals | null {
  let product = ZERO;
  let service = ZERO;
  let hasProduct = false;
  let hasService = false;
  for (const line of lines) {
    const type = classifyInvoiceLine(line);
    const lineCents = moneyCents(line.line_total ?? null);
    if (lineCents === null || lineCents < ZERO || type.product === type.service) return null;
    if (type.product) {
      product += lineCents;
      hasProduct = true;
    } else {
      service += lineCents;
      hasService = true;
    }
  }
  const productTotal = amount(product);
  const serviceTotal = amount(service);
  return hasProduct && hasService && product + service === moneyCents(invoiceTotal)
    && productTotal !== null && serviceTotal !== null ? { product: productTotal, service: serviceTotal } : null;
}

function compareAmounts(basis: AmountBasis, expectedCents: bigint | null, invoiceCents: bigint | null, invoiceCurrency: string): UniversalInvoiceComparison {
  const expected = expectedCents === null ? null : amount(expectedCents);
  const invoiced = invoiceCents === null ? null : amount(invoiceCents);
  const comparable = expected !== null && invoiced !== null && invoiceCurrency === "GTQ";
  return {
    basis, expected, invoiced,
    difference: comparable ? amount(invoiceCents! - expectedCents!) : null,
    expectedUnit: "GTQ", invoiceUnit: invoiceCurrency,
    matches: comparable && invoiceCents === expectedCents,
  };
}

function compareGuideInvoiceAmount(lines: PriceSnapshot[] | null, invoiceTotal: number, currency: string, basis: AmountBasis) {
  let estimate: bigint | null = lines ? ZERO : null;
  for (const line of lines ?? []) {
    const units = snapshotUnits(line.estimated_subtotal);
    if (line.unit_price == null || line.currency !== "GTQ" || units === null) {
      estimate = null;
      break;
    }
    estimate = (estimate ?? ZERO) + units;
  }
  return compareAmounts(basis, estimate === null ? null : cents(estimate), moneyCents(invoiceTotal), currency);
}

export function compareServiceInvoice(lines: PriceSnapshot[], invoiceTotal: number, invoiceCurrency: string) {
  return compareGuideInvoiceAmount(lines, invoiceTotal, invoiceCurrency, "SERVICE_TOTAL");
}

export function combinedInvoiceComparison(product: UniversalInvoiceComparison, service: UniversalInvoiceComparison): MixedInvoiceComparison {
  const productEstimate = moneyCents(product.expected);
  const serviceEstimate = moneyCents(service.expected);
  const productInvoice = moneyCents(product.invoiced);
  const serviceInvoice = moneyCents(service.invoiced);
  const total = compareAmounts(
    "INVOICE_TOTAL",
    productEstimate === null || serviceEstimate === null ? null : productEstimate + serviceEstimate,
    productInvoice === null || serviceInvoice === null ? null : productInvoice + serviceInvoice,
    product.invoiceUnit ?? "GTQ",
  );
  return { product, service, total };
}

export function compareMixedInvoice(totals: MixedInvoiceTotals, currency: string, snapshots?: { product: PriceSnapshot[]; service: PriceSnapshot[] }) {
  return combinedInvoiceComparison(
    compareGuideInvoiceAmount(snapshots?.product ?? null, totals.product, currency, "PRODUCT_TOTAL"),
    compareGuideInvoiceAmount(snapshots?.service ?? null, totals.service, currency, "SERVICE_TOTAL"),
  );
}

export function compareProductInvoice(payload: Pick<InvoiceProcessingPayload, "comparison_basis" | "comparison_quantity" | "comparison_unit_code" | "invoiced_quantity" | "normalized_unit" | "difference">): UniversalInvoiceComparison {
  const comparable = payload.comparison_quantity !== null && payload.comparison_unit_code !== null && payload.comparison_unit_code === payload.normalized_unit;
  return {
    basis: payload.comparison_basis,
    expected: payload.comparison_quantity, invoiced: payload.invoiced_quantity,
    expectedUnit: payload.comparison_unit_code, invoiceUnit: payload.normalized_unit,
    difference: comparable ? payload.difference : null,
    matches: comparable && payload.difference !== null && Math.abs(payload.difference) < 0.001,
  };
}

export function comparisonFromServiceSummary(summary: ServiceReconciliationSummary, basis: AmountBasis = "SERVICE_TOTAL"): UniversalInvoiceComparison | null {
  if (!summary.checkedAt) return null;
  return {
    basis, expected: summary.estimatedTotal, invoiced: summary.invoiceTotal,
    difference: summary.difference, expectedUnit: summary.currency, invoiceUnit: summary.invoiceCurrency,
    matches: summary.complete && summary.difference === 0 && summary.currency === summary.invoiceCurrency,
  };
}

export function hasReconciliationDifferences(result: {
  comparison?: UniversalInvoiceComparison | null;
  mixedComparison?: MixedInvoiceComparison | null;
  reconciliationStatus?: string;
  serviceReconciliationStatus?: string;
} | null) {
  const mixed = result?.mixedComparison;
  return result?.reconciliationStatus === "WITH_DIFFERENCES" || result?.serviceReconciliationStatus === "WITH_DIFFERENCES"
    || result?.comparison?.matches === false
    || Boolean(mixed && [mixed.product, mixed.service].some((part) => part.difference !== null && !part.matches));
}
