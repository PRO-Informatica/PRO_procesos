import "server-only";

import { extractMixtoListoInvoicePdf } from "@/features/batches/mixto-listo-extractor";
import { orderNumberFromMixtoListoPca, type MixtoListoParsedInvoice } from "@/features/batches/mixto-listo-parser";
import {
  normalizeBusinessIdentity,
  normalizeTaxIdentity,
} from "@/lib/business-identity";
import { compareAddresses, normalizeAddressIdentity } from "@/lib/address-identity";

import { classifyInvoiceLine, classifyInvoiceLines } from "./invoice-classification";
import { buildFiscalDocumentKey } from "./invoice-identity";
import {
  C14_REINVOICING_MESSAGE,
  evaluateInvoiceRecipientPolicy,
} from "./invoice-recipient-policy";

export type ProcessedInvoiceType = "PRODUCT" | "SERVICE" | "UNKNOWN";

export type InvoiceProcessingContext = {
  expectedType?: "PRODUCT" | "SERVICE";
  companyCode: string;
  orderNumber: string;
  supplierName: string;
  supplierTaxId: string | null;
  billingLegalName: string | null;
  billingTaxId: string | null;
  projectAddress: string | null;
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
  shipping_address: string | null;
  shipping_address_normalized: string | null;
  project_match_method: "EXACT_ADDRESS" | "CANONICAL_ADDRESS" | "TOLERANT_ADDRESS";
  authorization_number: string | null;
  series: string | null;
  issuer_tax_id_normalized: string;
  fiscal_document_key: string;
  file_sha256?: string;
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
  recipient_policy: {
    detected_identity: string | null;
    allowed: boolean;
    requires_reinvoicing: boolean;
    reason: "C14_NOT_ALLOWED_FOR_PROJECT" | null;
  };
  requires_reinvoicing: boolean;
  validations: Record<string, boolean>;
  warnings: string[];
  engine_version: "MIXTO_LISTO_PDF_TEXT_V3";
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

function sameMonth(date: string, accountingPeriod: string) {
  return date.slice(0, 7) === accountingPeriod.slice(0, 7);
}

export async function processInvoicePdf(
  buffer: ArrayBuffer,
  context: InvoiceProcessingContext,
): Promise<InvoiceProcessingResult> {
  const extracted = await extractMixtoListoInvoicePdf(buffer);
  return processExtractedInvoice(extracted, context);
}

export function processExtractedInvoice(
  extracted: MixtoListoParsedInvoice,
  context: InvoiceProcessingContext,
): InvoiceProcessingResult {
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
    const classification = classifyInvoiceLine(line);
    return {
      ...line,
      unit_code: normalizeInvoiceUnit(line.unit_code) ?? line.unit_code,
      conciliable: classification.product,
      service: classification.service,
    };
  });
  const productLines = lines.filter((line) => line.conciliable);
  const detectedType = classifyInvoiceLines(extracted.lines);
  const units = [...new Set(productLines.map((line) => line.unit_code))];
  const invoiceUnit = units.length === 1 ? units[0] : null;
  const invoicedQuantity = productLines.reduce((sum, line) => sum + line.quantity, 0);
  const detectedOrder = normalizeOperationalOrder(extracted.pca_original);
  const expectedOrder = normalizeOperationalOrder(context.orderNumber);
  const billingName = normalizeBusinessIdentity(extracted.billing_legal_name);
  const recipientPolicy = evaluateInvoiceRecipientPolicy({
    billingLegalName: extracted.billing_legal_name,
    companyCode: context.companyCode,
  });
  const supplierName = normalizeBusinessIdentity(extracted.supplier_legal_name);
  const expectedSupplierName = normalizeBusinessIdentity(context.supplierName);
  const supplierTax = normalizeTaxId(extracted.supplier_tax_id);
  const expectedSupplierTax = normalizeTaxId(context.supplierTaxId);
  const addressComparison = compareAddresses(
    context.projectAddress,
    extracted.shipping_address,
  );
  const projectValid = addressComparison.result === "MATCH";
  const configuredBillingNameMatches = Boolean(
    normalizeBusinessIdentity(context.billingLegalName) &&
      normalizeBusinessIdentity(context.billingLegalName) === billingName,
  );
  const billingNameValid = recipientPolicy.isC14
    ? recipientPolicy.allowed
    : configuredBillingNameMatches;
  const supplierValid = supplierTax && expectedSupplierTax
    ? supplierTax === expectedSupplierTax
    : Boolean(expectedSupplierName && supplierName === expectedSupplierName);
  const fiscalDocumentKey = buildFiscalDocumentKey({
    issuerTaxId: extracted.supplier_tax_id,
    authorizationNumber: extracted.authorization_number,
    series: extracted.series,
    invoiceNumber: extracted.invoice_number,
  });
  const expectedUnit = normalizeInvoiceUnit(context.realUnitCode);
  const difference = context.realVolume === null || detectedType !== "PRODUCT"
    ? null
    : Number((invoicedQuantity - context.realVolume).toFixed(3));
  const warnings: string[] = [];
  if (projectValid && addressComparison.matchMethod !== "EXACT") {
    warnings.push(
      `${addressComparison.warnings[0]} Dirección configurada: "${context.projectAddress?.trim() ?? ""}". Dirección detectada: "${extracted.shipping_address?.trim() ?? ""}".${addressComparison.differences.length ? ` ${addressComparison.differences.join(" ")}` : ""}`,
    );
  }
  const periodValid = sameMonth(extracted.invoice_date!, context.accountingPeriod);
  if (!periodValid) warnings.push("La fecha de la factura está fuera del período contable del lote.");
  if (recipientPolicy.requiresReinvoicing) {
    warnings.push(C14_REINVOICING_MESSAGE);
  } else if (!billingNameValid) {
    warnings.push("La dirección corresponde al proyecto, pero la razón social receptora es diferente.");
  }
  if (detectedType === "PRODUCT" && invoiceUnit !== expectedUnit)
    warnings.push("La unidad facturada no coincide con la unidad del Volumen Real.");
  if (difference !== null && Math.abs(difference) >= 0.001)
    warnings.push(`La cantidad facturada difiere del Volumen Real en ${difference}.`);

  const validations = {
    document_valid: true,
    type_valid: context.expectedType ? detectedType === context.expectedType : detectedType !== "UNKNOWN",
    project_valid: projectValid,
    billing_name_valid: billingNameValid,
    billing_society_allowed: recipientPolicy.allowed,
    requires_reinvoicing: recipientPolicy.requiresReinvoicing,
    supplier_valid: supplierValid,
    order_valid: detectedOrder !== null && detectedOrder === expectedOrder,
    period_valid: periodValid,
    unit_valid: detectedType === "SERVICE" || invoiceUnit === expectedUnit,
    quantity_valid: detectedType === "SERVICE" || difference === 0,
    fiscal_identity_valid: Boolean(fiscalDocumentKey),
  };
  const criticalErrors = [
    !validations.type_valid && "El tipo detectado no coincide con el espacio seleccionado.",
    !validations.project_valid && "La Dirección de Envío no corresponde a la Dirección exacta de Obra del proyecto.",
    !validations.supplier_valid && "El emisor no corresponde al proveedor del despacho.",
    !validations.order_valid && `El pedido detectado (${detectedOrder ?? "no detectado"}) no corresponde al pedido ${expectedOrder}.`,
    !validations.fiscal_identity_valid && "La factura no contiene una identidad fiscal estable (NIT emisor y autorización, o serie/número).",
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
      shipping_address: extracted.shipping_address,
      shipping_address_normalized: normalizeAddressIdentity(extracted.shipping_address) || null,
      project_match_method: addressComparison.matchMethod === "EXACT"
        ? "EXACT_ADDRESS"
        : addressComparison.matchMethod === "CANONICAL"
          ? "CANONICAL_ADDRESS"
          : "TOLERANT_ADDRESS",
      authorization_number: extracted.authorization_number,
      series: extracted.series,
      issuer_tax_id_normalized: supplierTax!,
      fiscal_document_key: fiscalDocumentKey!,
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
      recipient_policy: {
        detected_identity: recipientPolicy.detectedIdentity,
        allowed: recipientPolicy.allowed,
        requires_reinvoicing: recipientPolicy.requiresReinvoicing,
        reason: recipientPolicy.reason,
      },
      requires_reinvoicing: recipientPolicy.requiresReinvoicing,
      validations,
      warnings,
      engine_version: "MIXTO_LISTO_PDF_TEXT_V3",
    },
  };
}
