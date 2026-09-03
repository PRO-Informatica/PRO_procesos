import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { GuideReportData, GuideReportFilters, GuideReportRow, ProgrammingReportItem, ReportOption } from "./types";

type ProjectInput = { id: string; name: string; timezone: string };
type Row = Record<string, unknown>;
const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });
function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function programmingCode(id: string) { return `PRG-${id.slice(0, 8).toUpperCase()}`; }
function options(values: Array<[string, string]>): ReportOption[] { return [...new Map(values).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es")); }
function hasDispatchFilters(filters: GuideReportFilters) { return Boolean(filters.orderNumber || filters.batchId || filters.dispatchStatus || filters.orderStatus || filters.reconciliationStatus || filters.withIncidents); }

export async function getGuideReport(projects: ProjectInput[], filters: GuideReportFilters): Promise<GuideReportData> {
  const supabase = await createClient();
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
  const [guidesResult, incidentsResult, relationsResult, reconciliationsResult, invoicesResult] = await Promise.all([
    dispatchIds.length ? supabase.from("dispatch_guides").select("id, project_id, dispatch_id, guide_number, guide_date, quantity, unit_code").in("dispatch_id", dispatchIds) : empty<Row>(),
    dispatchIds.length ? supabase.from("dispatch_incidents").select("id, dispatch_id").in("dispatch_id", dispatchIds) : empty<{ id: string; dispatch_id: string }>(),
    dispatchIds.length ? supabase.from("batch_dispatches").select("dispatch_id, batch_id").in("dispatch_id", dispatchIds).is("removed_at", null) : empty<{ dispatch_id: string; batch_id: string }>(),
    dispatchIds.length ? supabase.from("dispatch_reconciliations").select("dispatch_id, status, current_product_invoice_id, current_service_invoice_id").in("dispatch_id", dispatchIds) : empty<{ dispatch_id: string; status: string; current_product_invoice_id: string | null; current_service_invoice_id: string | null }>(),
    dispatchIds.length ? supabase.from("invoices").select("id, dispatch_id, invoice_type, invoiced_quantity, status, replaces_invoice_id").in("dispatch_id", dispatchIds) : empty<{ id: string; dispatch_id: string; invoice_type: string; invoiced_quantity: number | string | null; status: string; replaces_invoice_id: string | null }>(),
  ]);
  const relatedError = guidesResult.error ?? incidentsResult.error ?? relationsResult.error ?? reconciliationsResult.error ?? invoicesResult.error;
  if (relatedError) throw new Error(`No fue posible completar la reportaría. ${relatedError.message}`);
  const guides = (guidesResult.data ?? []) as Row[];
  const guideIds = guides.map((guide) => String(guide.id));
  const incidentIds = (incidentsResult.data ?? []).map((incident) => incident.id);
  const batchIds = [...new Set((relationsResult.data ?? []).map((relation) => relation.batch_id))];
  const supplierIds = [...new Set(programs.map((program) => String(program.supplier_id)))];
  const creatorIds = [...new Set([...programs.map((program) => String(program.created_by)), ...dispatches.map((dispatch) => String(dispatch.created_by))])];
  const [guideDocs, incidentDocs, suppliers, profiles, batches] = await Promise.all([
    guideIds.length ? supabase.from("guide_documents").select("guide_id, document_id").in("guide_id", guideIds) : empty<{ guide_id: string; document_id: string }>(),
    incidentIds.length ? supabase.from("incident_documents").select("incident_id, document_id").in("incident_id", incidentIds) : empty<{ incident_id: string; document_id: string }>(),
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : empty<{ id: string; name: string }>(),
    creatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", creatorIds) : empty<{ id: string; full_name: string | null }>(),
    batchIds.length ? supabase.from("batches").select("id, code").in("id", batchIds) : empty<{ id: string; code: string }>(),
  ]);
  const detailError = guideDocs.error ?? incidentDocs.error ?? suppliers.error ?? profiles.error ?? batches.error;
  if (detailError) throw new Error("No fue posible resolver documentos o catálogos de reportaría.");

  const supplierMap = new Map((suppliers.data ?? []).map((row) => [row.id, row.name]));
  const profileMap = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name?.trim() || "Usuario no disponible"]));
  const batchMap = new Map((batches.data ?? []).map((row) => [row.id, row.code]));
  const batchByDispatch = new Map((relationsResult.data ?? []).map((row) => [row.dispatch_id, row.batch_id]));
  const reconciliationByDispatch = new Map((reconciliationsResult.data ?? []).map((row) => [row.dispatch_id, row]));
  const invoicesByDispatch = new Map<string, typeof invoicesResult.data>();
  for (const invoice of invoicesResult.data ?? []) invoicesByDispatch.set(invoice.dispatch_id, [...(invoicesByDispatch.get(invoice.dispatch_id) ?? []), invoice]);
  const dispatchByProgram = new Map<string, Row[]>();
  for (const dispatch of dispatches) dispatchByProgram.set(String(dispatch.programming_id), [...(dispatchByProgram.get(String(dispatch.programming_id)) ?? []), dispatch]);
  const guidesByDispatch = new Map<string, Row[]>();
  for (const guide of guides) guidesByDispatch.set(String(guide.dispatch_id), [...(guidesByDispatch.get(String(guide.dispatch_id)) ?? []), guide]);
  const incidentsByDispatch = new Map<string, string[]>();
  for (const incident of incidentsResult.data ?? []) incidentsByDispatch.set(incident.dispatch_id, [...(incidentsByDispatch.get(incident.dispatch_id) ?? []), incident.id]);
  const guideDocCount = new Map<string, number>();
  for (const document of guideDocs.data ?? []) guideDocCount.set(document.guide_id, (guideDocCount.get(document.guide_id) ?? 0) + 1);
  const incidentDocCount = new Map<string, number>();
  for (const document of incidentDocs.data ?? []) incidentDocCount.set(document.incident_id, (incidentDocCount.get(document.incident_id) ?? 0) + 1);

  let programming: ProgrammingReportItem[] = programs.map((program) => {
    const project = projectMap.get(String(program.project_id));
    let children: GuideReportRow[] = (dispatchByProgram.get(String(program.id)) ?? []).flatMap((dispatch) => {
      const dispatchId = String(dispatch.id);
      const dispatchGuides = guidesByDispatch.get(dispatchId) ?? [];
      const reconciliation = reconciliationByDispatch.get(dispatchId);
      const dispatchInvoices = invoicesByDispatch.get(dispatchId) ?? [];
      const product = dispatchInvoices.find((invoice) => invoice.id === reconciliation?.current_product_invoice_id);
      const batchId = batchByDispatch.get(dispatchId) ?? null;
      const incidentList = incidentsByDispatch.get(dispatchId) ?? [];
      return (dispatchGuides.length ? dispatchGuides : [undefined]).map((guide) => ({
        guideId: String(guide?.id ?? `dispatch:${dispatchId}`), dispatchId,
        projectId: String(program.project_id), projectName: project?.name ?? "Proyecto", timezone: project?.timezone ?? "America/Guatemala",
        guideNumber: String(guide?.guide_number ?? "Sin guía"), guideDate: String(guide?.guide_date ?? String(program.scheduled_at).slice(0, 10)),
        guideTime: dispatch.arrival_at ? String(dispatch.arrival_at) : null,
        supplierId: String(dispatch.supplier_id), supplierName: supplierMap.get(String(dispatch.supplier_id)) ?? "Proveedor no disponible",
        programmingCode: programmingCode(String(program.id)), orderNumber: dispatch.order_number ? String(dispatch.order_number) : null,
        batchId, batchCode: batchId ? batchMap.get(batchId) ?? null : null,
        documentedQuantity: numeric(guide?.quantity), unitCode: String(guide?.unit_code ?? dispatch.real_unit_code ?? program.unit_code ?? ""),
        receivedQuantity: numeric(dispatch.real_volume), physicalResult: String(dispatch.result ?? "PENDING"), dispatchStatus: String(dispatch.status),
        registeredById: String(dispatch.created_by), registeredByName: profileMap.get(String(dispatch.created_by)) ?? "Usuario no disponible", createdAt: String(dispatch.created_at),
        incidentCount: incidentList.length,
        documentCount: (guide ? guideDocCount.get(String(guide.id)) ?? 0 : 0) + incidentList.reduce((sum, id) => sum + (incidentDocCount.get(id) ?? 0), 0),
        orderStatus: reconciliation?.status ?? "PENDING_INVOICES", reinvoicingRequired: reconciliation?.status === "PENDING_REINVOICING",
        reconciliationStatus: reconciliation?.status ?? "PENDING_INVOICES", productInvoicedQuantity: numeric(product?.invoiced_quantity),
        difference: product ? numeric(product.invoiced_quantity) - numeric(dispatch.real_volume) : 0, invoiceCount: dispatchInvoices.length,
      }));
    });
    if (filters.orderNumber) children = children.filter((row) => row.orderNumber?.toLowerCase().includes(filters.orderNumber!.toLowerCase()));
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
