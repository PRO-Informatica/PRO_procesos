import "server-only";

import { extractMixtoListoInvoicePdf } from "@/features/batches/mixto-listo-extractor";
import { orderNumberFromMixtoListoPca } from "@/features/batches/mixto-listo-parser";
import {
  matchesFiscalIdentity,
  normalizeBusinessIdentity,
  normalizeTaxIdentity,
} from "@/lib/business-identity";

export type ProcessedInvoiceType = "PRODUCT" | "SERVICE" | "UNKNOWN";

export type InvoiceProcessingContext = {
  expectedType?: "PRODUCT" | "SERVICE";
  orderNumber: string;
  supplierName: string;
  supplierTaxId: string | null;
  billingLegalName: string | null;
  billingTaxId: string | null;
  accountingPeriod: string;
  realVolume: number | null;
  realUnitCode: string | null;
};

export type InvoiceProcessingPayload = {
  invoice_number: string;
  invoice_date: string;
  currency: string;
  subtotal: number;
  total: number;
  detected_type: ProcessedInvoiceType;
  billing_legal_name: string | null;
  billing_legal_name_normalized: string | null;
  billing_tax_id: string | null;
  supplier_legal_name: string | null;
  supplier_legal_name_normalized: string | null;
  supplier_tax_id: string | null;
  pca_original: string | null;
  detected_order_number: string | null;
  lines: Array<{
    quantity: number;
    unit_code: string;
    code: string;
    description: string;
    conciliable: boolean;
  }>;
  invoiced_quantity: number;
  normalized_unit: string | null;
  expected_real_volume: number | null;
  difference: number | null;
  validations: Record<string, boolean>;
  warnings: string[];
  engine_version: "MIXTO_LISTO_PDF_TEXT_V2";
};

export type InvoiceProcessingResult =
  | { status: "error"; message: string; details: string[] }
  | { status: "success"; payload: InvoiceProcessingPayload };

export function normalizeTaxId(value: string | null | undefined) {
  return normalizeTaxIdentity(value);
}

export function normalizeInvoiceUnit(value: string | null | undefined) {
  const unit = value?.trim().toUpperCase().replace(/³/g, "3") ?? "";
  return unit === "M3" ? "M3" : unit || null;
}

export function normalizeOperationalOrder(value: string | null | undefined) {
  const compact = value?.trim() ?? "";
  if (!compact) return null;
  const pca = orderNumberFromMixtoListoPca(compact);
  if (pca) return pca;
  return /^\d+$/.test(compact)
    ? compact.replace(/^0+(?=\d)/, "")
    : compact.toUpperCase().replace(/\s+/g, "");
}

function normalizedDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function classifyLine(code: string, description: string) {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedText = normalizedDescription(description);
  const product = /^\d+$/.test(normalizedCode) && normalizedText.startsWith("CON");
  const service = /^SERV\d+/i.test(normalizedCode) ||
    /^(BOMBEO|DOSIS|KM\.? EXTRA|SERVICIO|TRANSPORTE)/.test(normalizedText);
  return { product, service };
}

function sameMonth(date: string, accountingPeriod: string) {
  return date.slice(0, 7) === accountingPeriod.slice(0, 7);
}

export async function processInvoicePdf(
  buffer: ArrayBuffer,
  context: InvoiceProcessingContext,
): Promise<InvoiceProcessingResult> {
  const extracted = await extractMixtoListoInvoicePdf(buffer);
  const required = [
    extracted.invoice_number,
    extracted.invoice_date,
    extracted.currency,
    extracted.total,
    extracted.pca_original,
  ];
  const details: string[] = [];
  if (required.some((value) => value === null) || extracted.lines.length === 0) {
    details.push("No se encontraron todos los campos mínimos de una factura digital.");
  }
  if (extracted.detected_invoice_numbers.length > 1) {
    details.push("El PDF contiene más de un número de factura.");
  }
  if (details.length) {
    return {
      status: "error",
      message: "El documento no corresponde a una factura digital individual procesable.",
      details,
    };
  }

  const lines = extracted.lines.map((line) => {
    const classification = classifyLine(line.code, line.description);
    return {
      ...line,
      unit_code: normalizeInvoiceUnit(line.unit_code) ?? line.unit_code,
      conciliable: classification.product,
      service: classification.service,
    };
  });
  const productLines = lines.filter((line) => line.conciliable);
  const hasService = lines.some((line) => line.service);
  const detectedType: ProcessedInvoiceType = productLines.length
    ? "PRODUCT"
    : hasService
      ? "SERVICE"
      : "UNKNOWN";
  const units = [...new Set(productLines.map((line) => line.unit_code))];
  const invoiceUnit = units.length === 1 ? units[0] : null;
  const invoicedQuantity = productLines.reduce((sum, line) => sum + line.quantity, 0);
  const detectedOrder = normalizeOperationalOrder(extracted.pca_original);
  const expectedOrder = normalizeOperationalOrder(context.orderNumber);
  const billingName = normalizeBusinessIdentity(extracted.billing_legal_name);
  const supplierName = normalizeBusinessIdentity(extracted.supplier_legal_name);
  const expectedSupplierName = normalizeBusinessIdentity(context.supplierName);
  const supplierTax = normalizeTaxId(extracted.supplier_tax_id);
  const expectedSupplierTax = normalizeTaxId(context.supplierTaxId);
  const projectValid = matchesFiscalIdentity({
    expectedName: context.billingLegalName,
    actualName: extracted.billing_legal_name,
    expectedTaxId: context.billingTaxId,
    actualTaxId: extracted.billing_tax_id,
  });
  const supplierValid = expectedSupplierTax
    ? supplierTax === expectedSupplierTax
    : Boolean(expectedSupplierName && supplierName === expectedSupplierName);
  const expectedUnit = normalizeInvoiceUnit(context.realUnitCode);
  const difference = context.realVolume === null || detectedType !== "PRODUCT"
    ? null
    : Number((invoicedQuantity - context.realVolume).toFixed(3));
  const warnings: string[] = [];
  const periodValid = sameMonth(extracted.invoice_date!, context.accountingPeriod);
  if (!periodValid) warnings.push("La fecha de la factura está fuera del período contable del lote.");
  if (detectedType === "PRODUCT" && invoiceUnit !== expectedUnit)
    warnings.push("La unidad facturada no coincide con la unidad del Volumen Real.");
  if (difference !== null && Math.abs(difference) >= 0.001)
    warnings.push(`La cantidad facturada difiere del Volumen Real en ${difference}.`);

  const validations = {
    document_valid: true,
    type_valid: context.expectedType ? detectedType === context.expectedType : detectedType !== "UNKNOWN",
    project_valid: projectValid,
    supplier_valid: supplierValid,
    order_valid: detectedOrder !== null && detectedOrder === expectedOrder,
    period_valid: periodValid,
    unit_valid: detectedType === "SERVICE" || invoiceUnit === expectedUnit,
    quantity_valid: detectedType === "SERVICE" || difference === 0,
  };
  const criticalErrors = [
    !validations.type_valid && "El tipo detectado no coincide con el espacio seleccionado.",
    !validations.project_valid && "La factura no corresponde al receptor fiscal del proyecto.",
    !validations.supplier_valid && "El emisor no corresponde al proveedor del despacho.",
    !validations.order_valid && `El pedido detectado (${detectedOrder ?? "no detectado"}) no corresponde al pedido ${expectedOrder}.`,
  ].filter((value): value is string => Boolean(value));
  if (criticalErrors.length) {
    return {
      status: "error",
      message: "El PDF no puede asociarse a este despacho.",
      details: criticalErrors,
    };
  }

  return {
    status: "success",
    payload: {
      invoice_number: extracted.invoice_number!,
      invoice_date: extracted.invoice_date!,
      currency: extracted.currency!,
      subtotal: extracted.subtotal ?? extracted.total!,
      total: extracted.total!,
      detected_type: detectedType,
      billing_legal_name: extracted.billing_legal_name,
      billing_legal_name_normalized: billingName,
      billing_tax_id: extracted.billing_tax_id,
      supplier_legal_name: extracted.supplier_legal_name,
      supplier_legal_name_normalized: supplierName,
      supplier_tax_id: extracted.supplier_tax_id,
      pca_original: extracted.pca_original,
      detected_order_number: detectedOrder,
      lines: lines.map((line) => ({
        quantity: line.quantity,
        unit_code: line.unit_code,
        code: line.code,
        description: line.description,
        conciliable: line.conciliable,
      })),
      invoiced_quantity: invoicedQuantity,
      normalized_unit: invoiceUnit,
      expected_real_volume: context.realVolume,
      difference,
      validations,
      warnings,
      engine_version: "MIXTO_LISTO_PDF_TEXT_V2",
    },
  };
}
