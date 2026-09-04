import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { GuideReportData, GuideReportFilters, GuideReportRow, ProgrammingReportItem, ReportInvoice, ReportOption } from "./types";

type ProjectInput = { id: string; name: string; timezone: string };
type Row = Record<string, unknown>;
const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });

function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function optionalNumeric(value: unknown) { return value === null || value === undefined ? null : numeric(value); }
function optionalText(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function objectValue(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function programmingCode(id: string) { return `PRG-${id.slice(0, 8).toUpperCase()}`; }
function dispatchCode(id: string) { return `DSP-${id.slice(0, 8).toUpperCase()}`; }
function options(values: Array<[string, string]>): ReportOption[] { return [...new Map(values).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es")); }
function hasDispatchFilters(filters: GuideReportFilters) { return Boolean(filters.orderNumber || filters.batchId || filters.dispatchStatus || filters.orderStatus || filters.reconciliationStatus || filters.withIncidents); }

export async function getGuideReport(projects: ProjectInput[], filters: GuideReportFilters): Promise<GuideReportData> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const allowed = new Set(projects.map((project) => project.id));
  const projectIds = filters.projectId && allowed.has(filters.projectId) ? [filters.projectId] : projects.map((project) => project.id);
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const blank: GuideReportData = { rows: [], programming: [], filters: { projects: options(projects.map((project) => [project.id, project.name])), suppliers: [], users: [], batches: [] } };
  if (!projectIds.length) return blank;

  let programmingQuery = supabase.from("programming").select("id, project_id, supplier_id, scheduled_at, requested_quantity, confirmed_quantity, unit_code, status, created_by").in("project_id", projectIds).gte("scheduled_at", `${filters.dateFrom}T00:00:00`).lte("scheduled_at", `${filters.dateTo}T23:59:59.999`).order("scheduled_at");
  if (filters.supplierId) programmingQuery = programmingQuery.eq("supplier_id", filters.supplierId);
  if (filters.programmingStatus) programmingQuery = programmingQuery.eq("status", filters.programmingStatus);
  const programmingResult = await programmingQuery;
  if (programmingResult.error) throw new Error(`No fue posible cargar las programaciones. ${programmingResult.error.message}`);
  const programs = (programmingResult.data ?? []) as Row[];
  if (!programs.length) return blank;

  const programmingIds = programs.map((program) => String(program.id));
  const dispatchesResult = await supabase.from("dispatches").select("id, project_id, supplier_id, programming_id, status, result, order_number, real_volume, real_unit_code, arrival_at, created_by, created_at").in("programming_id", programmingIds).order("created_at");
  if (dispatchesResult.error) throw new Error(`No fue posible cargar los despachos. ${dispatchesResult.error.message}`);
  const dispatches = (dispatchesResult.data ?? []) as Row[];
  const dispatchIds = dispatches.map((dispatch) => String(dispatch.id));

  const [guidesResult, incidentsResult, relationsResult, reconciliationsResult, invoicesResult, attemptsResult] = await Promise.all([
    dispatchIds.length ? supabase.from("dispatch_guides").select("id, dispatch_id, quantity, unit_code").in("dispatch_id", dispatchIds) : empty<Row>(),
    dispatchIds.length ? supabase.from("dispatch_incidents").select("id, dispatch_id").in("dispatch_id", dispatchIds) : empty<{ id: string; dispatch_id: string }>(),
    dispatchIds.length ? supabase.from("batch_dispatches").select("dispatch_id, batch_id").in("dispatch_id", dispatchIds).is("removed_at", null) : empty<{ dispatch_id: string; batch_id: string }>(),
    dispatchIds.length ? supabase.from("dispatch_reconciliations").select("dispatch_id, status, current_product_invoice_id, current_service_invoice_id").in("dispatch_id", dispatchIds) : empty<{ dispatch_id: string; status: string; current_product_invoice_id: string | null; current_service_invoice_id: string | null }>(),
    dispatchIds.length ? supabase.from("invoices").select("id, dispatch_id, invoice_type, invoice_number, invoice_date, status, subtotal, total, currency, order_number, pca_original, invoiced_quantity, invoiced_unit_code, created_at").in("dispatch_id", dispatchIds) : empty<Row>(),
    dispatchIds.length ? supabase.from("dispatch_reconciliation_attempts").select("dispatch_id, difference, executed_at").in("dispatch_id", dispatchIds).order("executed_at", { ascending: false }) : empty<Row>(),
  ]);
  const relatedError = guidesResult.error ?? incidentsResult.error ?? relationsResult.error ?? reconciliationsResult.error ?? invoicesResult.error ?? attemptsResult.error;
  if (relatedError) throw new Error(`No fue posible completar la reportería. ${relatedError.message}`);

  const guides = (guidesResult.data ?? []) as Row[];
  const guideIds = guides.map((guide) => String(guide.id));
  const incidentIds = (incidentsResult.data ?? []).map((incident) => incident.id);
  const batchIds = [...new Set((relationsResult.data ?? []).map((relation) => relation.batch_id))];
  const supplierIds = [...new Set([...programs.map((program) => String(program.supplier_id)), ...dispatches.map((dispatch) => String(dispatch.supplier_id))])];
  const creatorIds = [...new Set([...programs.map((program) => String(program.created_by)), ...dispatches.map((dispatch) => String(dispatch.created_by))])];
  const invoiceIds = (invoicesResult.data ?? []).map((invoice) => String(invoice.id));

  const [guideDocs, incidentDocs, suppliers, profiles, batches, invoiceDocuments, invoiceExtractions] = await Promise.all([
    guideIds.length ? supabase.from("guide_documents").select("guide_id, document_id").in("guide_id", guideIds) : empty<{ guide_id: string; document_id: string }>(),
    incidentIds.length ? supabase.from("incident_documents").select("incident_id, document_id").in("incident_id", incidentIds) : empty<{ incident_id: string; document_id: string }>(),
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : empty<{ id: string; name: string }>(),
    creatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", creatorIds) : empty<{ id: string; full_name: string | null }>(),
    batchIds.length ? supabase.from("batches").select("id, code").in("id", batchIds) : empty<{ id: string; code: string }>(),
    invoiceIds.length ? admin.from("invoice_documents").select("invoice_id, document_id").in("invoice_id", invoiceIds).in("project_id", projectIds) : empty<{ invoice_id: string; document_id: string }>(),
    invoiceIds.length ? admin.from("invoice_extractions").select("invoice_id, verification_status, normalized_payload, corrected_payload, created_at").in("invoice_id", invoiceIds).order("created_at", { ascending: false }) : empty<Row>(),
  ]);
  const detailError = guideDocs.error ?? incidentDocs.error ?? suppliers.error ?? profiles.error ?? batches.error ?? invoiceDocuments.error ?? invoiceExtractions.error;
  if (detailError) throw new Error("No fue posible resolver documentos o catálogos de reportería.");
  const invoiceDocumentIds = (invoiceDocuments.data ?? []).map((row) => row.document_id);
  const invoiceVersions = invoiceDocumentIds.length ? await admin.from("document_versions").select("document_id, file_name").in("document_id", invoiceDocumentIds).eq("upload_status", "UPLOADED").eq("is_current", true) : { data: [], error: null };
  if (invoiceVersions.error) throw new Error("No fue posible resolver los documentos de factura.");

  const supplierMap = new Map((suppliers.data ?? []).map((row) => [row.id, row.name]));
  const profileMap = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name?.trim() || "Usuario no disponible"]));
  const batchMap = new Map((batches.data ?? []).map((row) => [row.id, row.code]));
  const batchByDispatch = new Map((relationsResult.data ?? []).map((row) => [row.dispatch_id, row.batch_id]));
  const reconciliationByDispatch = new Map((reconciliationsResult.data ?? []).map((row) => [row.dispatch_id, row]));
  const documentByInvoice = new Map((invoiceDocuments.data ?? []).map((row) => [row.invoice_id, row.document_id]));
  const fileByDocument = new Map((invoiceVersions.data ?? []).map((row) => [row.document_id, row.file_name]));
  const extractionByInvoice = new Map<string, Row>();
  for (const extraction of invoiceExtractions.data ?? []) { const id = String(extraction.invoice_id ?? ""); if (id && !extractionByInvoice.has(id)) extractionByInvoice.set(id, extraction); }
  const invoiceById = new Map<string, ReportInvoice>();
  for (const invoice of invoicesResult.data ?? []) {
    const id = String(invoice.id);
    const extraction = extractionByInvoice.get(id);
    const payload = objectValue(extraction?.corrected_payload ?? extraction?.normalized_payload);
    const documentId = documentByInvoice.get(id) ?? null;
    invoiceById.set(id, {
      id, type: String(invoice.invoice_type) as ReportInvoice["type"], number: String(invoice.invoice_number), date: String(invoice.invoice_date), status: String(invoice.status),
      subtotal: numeric(invoice.subtotal), total: numeric(invoice.total), currency: String(invoice.currency), orderNumber: optionalText(invoice.order_number), pcaOriginal: optionalText(invoice.pca_original),
      invoicedQuantity: optionalNumeric(invoice.invoiced_quantity), unitCode: optionalText(invoice.invoiced_unit_code), documentId, fileName: documentId ? fileByDocument.get(documentId) ?? null : null,
      extractionStatus: optionalText(extraction?.verification_status), supplierLegalName: optionalText(payload.supplier_legal_name), supplierTaxId: optionalText(payload.supplier_tax_id), billingLegalName: optionalText(payload.billing_legal_name), billingTaxId: optionalText(payload.billing_tax_id),
    });
  }

  const latestAttemptByDispatch = new Map<string, Row>();
  for (const attempt of attemptsResult.data ?? []) { const id = String(attempt.dispatch_id); if (!latestAttemptByDispatch.has(id)) latestAttemptByDispatch.set(id, attempt); }
  const dispatchByProgram = new Map<string, Row[]>();
  for (const dispatch of dispatches) { const id = String(dispatch.programming_id); dispatchByProgram.set(id, [...(dispatchByProgram.get(id) ?? []), dispatch]); }
  const guidesByDispatch = new Map<string, Row[]>();
  for (const guide of guides) { const id = String(guide.dispatch_id); guidesByDispatch.set(id, [...(guidesByDispatch.get(id) ?? []), guide]); }
  const incidentsByDispatch = new Map<string, string[]>();
  for (const incident of incidentsResult.data ?? []) incidentsByDispatch.set(incident.dispatch_id, [...(incidentsByDispatch.get(incident.dispatch_id) ?? []), incident.id]);
  const guideDocCount = new Map<string, number>();
  for (const document of guideDocs.data ?? []) guideDocCount.set(document.guide_id, (guideDocCount.get(document.guide_id) ?? 0) + 1);
  const incidentDocCount = new Map<string, number>();
  for (const document of incidentDocs.data ?? []) incidentDocCount.set(document.incident_id, (incidentDocCount.get(document.incident_id) ?? 0) + 1);

  let programming: ProgrammingReportItem[] = programs.map((program) => {
    const project = projectMap.get(String(program.project_id));
    let children: GuideReportRow[] = (dispatchByProgram.get(String(program.id)) ?? []).map((dispatch) => {
      const id = String(dispatch.id);
      const dispatchGuides = guidesByDispatch.get(id) ?? [];
      const reconciliation = reconciliationByDispatch.get(id);
      const productInvoice = reconciliation?.current_product_invoice_id ? invoiceById.get(reconciliation.current_product_invoice_id) ?? null : null;
      const serviceInvoice = reconciliation?.current_service_invoice_id ? invoiceById.get(reconciliation.current_service_invoice_id) ?? null : null;
      const batchId = batchByDispatch.get(id) ?? null;
      const incidentList = incidentsByDispatch.get(id) ?? [];
      return {
        dispatchId: id, dispatchCode: dispatchCode(id), projectId: String(program.project_id), projectName: project?.name ?? "Proyecto", timezone: project?.timezone ?? "America/Guatemala",
        supplierId: String(dispatch.supplier_id), supplierName: supplierMap.get(String(dispatch.supplier_id)) ?? "Proveedor no disponible", programmingCode: programmingCode(String(program.id)),
        orderNumber: optionalText(dispatch.order_number), batchId, batchCode: batchId ? batchMap.get(batchId) ?? null : null, guideCount: dispatchGuides.length,
        documentedQuantity: dispatchGuides.reduce((sum, guide) => sum + numeric(guide.quantity), 0), unitCode: String(dispatch.real_unit_code ?? program.unit_code ?? ""), receivedQuantity: numeric(dispatch.real_volume),
        physicalResult: String(dispatch.result ?? "PENDING"), dispatchStatus: String(dispatch.status), registeredById: String(dispatch.created_by), registeredByName: profileMap.get(String(dispatch.created_by)) ?? "Usuario no disponible", createdAt: String(dispatch.created_at),
        incidentCount: incidentList.length, documentCount: dispatchGuides.reduce((sum, guide) => sum + (guideDocCount.get(String(guide.id)) ?? 0), 0) + incidentList.reduce((sum, incidentId) => sum + (incidentDocCount.get(incidentId) ?? 0), 0),
        orderStatus: reconciliation?.status ?? "PENDING_INVOICES", reinvoicingRequired: reconciliation?.status === "PENDING_REINVOICING", reconciliationStatus: reconciliation?.status ?? "PENDING_INVOICES",
        productInvoicedQuantity: productInvoice?.invoicedQuantity ?? 0, difference: numeric(latestAttemptByDispatch.get(id)?.difference), invoiceCount: [productInvoice, serviceInvoice].filter(Boolean).length, productInvoice, serviceInvoice,
      };
    });
    if (filters.orderNumber) { const order = filters.orderNumber.toLowerCase(); children = children.filter((row) => row.orderNumber?.toLowerCase().includes(order)); }
    if (filters.batchId) children = children.filter((row) => row.batchId === filters.batchId);
    if (filters.dispatchStatus) children = children.filter((row) => row.dispatchStatus === filters.dispatchStatus);
    if (filters.orderStatus) children = children.filter((row) => filters.orderStatus === "REINVOICING" ? row.reinvoicingRequired : row.orderStatus === filters.orderStatus);
    if (filters.reconciliationStatus) children = children.filter((row) => row.reconciliationStatus === filters.reconciliationStatus);
    if (filters.withIncidents) children = children.filter((row) => filters.withIncidents === "yes" ? row.incidentCount > 0 : row.incidentCount === 0);
    return { id: String(program.id), code: programmingCode(String(program.id)), projectId: String(program.project_id), projectName: project?.name ?? "Proyecto", timezone: project?.timezone ?? "America/Guatemala", supplierId: String(program.supplier_id), supplierName: supplierMap.get(String(program.supplier_id)) ?? "Proveedor no disponible", scheduledAt: String(program.scheduled_at), requestedQuantity: numeric(program.requested_quantity), confirmedQuantity: program.confirmed_quantity === null ? null : numeric(program.confirmed_quantity), unitCode: String(program.unit_code), status: String(program.status), createdById: String(program.created_by), createdByName: profileMap.get(String(program.created_by)) ?? "Usuario no disponible", dispatches: children };
  });
  if (hasDispatchFilters(filters)) programming = programming.filter((program) => program.dispatches.length > 0);
  if (filters.userId) programming = programming.filter((program) => program.createdById === filters.userId || program.dispatches.some((dispatch) => dispatch.registeredById === filters.userId));
  return { rows: programming.flatMap((program) => program.dispatches), programming, filters: { projects: options(projects.map((project) => [project.id, project.name])), suppliers: options([...supplierMap.entries()]), users: options([...profileMap.entries()]), batches: options((batches.data ?? []).map((batch) => [batch.id, batch.code])) } };
}
