import type { InvoiceProcessingPayload } from "../invoice-processing";
import type { ServiceReconciliationSummary } from "../service-reconciliation";

export type UniversalInvoiceComparison = {
  basis: "SERVICE_TOTAL" | "REAL_VOLUME" | "PROGRAMMED_QUANTITY";
  expected: number | null;
  invoiced: number | null;
  difference: number | null;
  expectedUnit: string | null;
  invoiceUnit: string | null;
  matches: boolean;
};

type ServiceSnapshot = { unit_price: unknown; estimated_subtotal: unknown; currency: string | null };
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

export function compareServiceInvoice(lines: ServiceSnapshot[], invoiceTotal: number, invoiceCurrency: string): UniversalInvoiceComparison {
  const snapshots = lines.map((line) => snapshotUnits(line.estimated_subtotal));
  const complete = lines.every((line, index) => line.unit_price !== null && line.unit_price !== undefined && line.currency === "GTQ" && snapshots[index] !== null);
  const expectedCents = complete ? cents(snapshots.reduce<bigint>((total, value) => total + (value ?? ZERO), ZERO)) : null;
  const invoiceUnits = snapshotUnits(invoiceTotal);
  const invoiceCents = invoiceUnits === null ? null : cents(invoiceUnits);
  const expected = expectedCents === null ? null : amount(expectedCents);
  const invoiced = invoiceCents === null ? null : amount(invoiceCents);
  const comparable = expected !== null && invoiced !== null && invoiceCurrency === "GTQ";
  return {
    basis: "SERVICE_TOTAL", expected, invoiced,
    difference: comparable ? amount(invoiceCents! - expectedCents!) : null,
    expectedUnit: "GTQ", invoiceUnit: invoiceCurrency,
    matches: comparable && invoiceCents === expectedCents,
  };
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

export function comparisonFromServiceSummary(summary: ServiceReconciliationSummary): UniversalInvoiceComparison | null {
  if (!summary.checkedAt) return null;
  return {
    basis: "SERVICE_TOTAL", expected: summary.estimatedTotal, invoiced: summary.invoiceTotal,
    difference: summary.difference, expectedUnit: summary.currency, invoiceUnit: summary.invoiceCurrency,
    matches: summary.complete && summary.difference === 0 && summary.currency === summary.invoiceCurrency,
  };
}

export function hasReconciliationDifferences(result: { comparison?: UniversalInvoiceComparison | null; reconciliationStatus?: string } | null) {
  return result?.reconciliationStatus === "WITH_DIFFERENCES" || result?.comparison?.matches === false;
}
