import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { GuideReportData, GuideReportFilters, GuideReportRow, ProgrammingReportItem, ReportOption } from "./types";

type ProjectInput = { id: string; name: string; timezone: string };
type Row = Record<string, unknown>;
const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });
function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function programmingCode(id: string) { return `PRG-${id.slice(0, 8).toUpperCase()}`; }
function normalizeOrder(value: unknown) { let normalized = String(value ?? "").trim(); if (!normalized) return null; if (normalized.toUpperCase().startsWith("PCA-")) normalized = normalized.replace(/^.*-/u, ""); if (/^[0-9]+$/u.test(normalized)) return normalized.replace(/^0+/u, "") || "0"; return normalized.toUpperCase().replace(/\s+/gu, ""); }
function effectiveOrderStatus(status: string | null, hasProduct: boolean) { if (status === "MATCHED") return "COMPLETED"; if (hasProduct && ["PARTIAL", "WITH_DIFFERENCES", "REQUIRES_REVIEW"].includes(status ?? "")) return "REINVOICING"; return "PENDING"; }
function options(values: Array<[string, string]>): ReportOption[] { return [...new Map(values).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es")); }
function hasDispatchFilters(filters: GuideReportFilters) { return Boolean(filters.orderNumber || filters.batchId || filters.dispatchStatus || filters.orderStatus || filters.reconciliationStatus || filters.withIncidents); }

export async function getGuideReport(projects: ProjectInput[], filters: GuideReportFilters): Promise<GuideReportData> {
  const supabase = await createClient(); const allowed = new Set(projects.map((p) => p.id)); const projectIds = filters.projectId && allowed.has(filters.projectId) ? [filters.projectId] : projects.map((p) => p.id); const projectMap = new Map(projects.map((p) => [p.id, p]));
  const blank: GuideReportData = { rows: [], programming: [], filters: { projects: options(projects.map((p) => [p.id, p.name])), suppliers: [], users: [], batches: [] } };
  if (!projectIds.length) return blank;
  let programmingQuery = supabase.from("programming").select("id, project_id, supplier_id, scheduled_at, requested_quantity, confirmed_quantity, unit_code, status, created_by").in("project_id", projectIds).gte("scheduled_at", `${filters.dateFrom}T00:00:00`).lte("scheduled_at", `${filters.dateTo}T23:59:59.999`).order("scheduled_at");
  if (filters.supplierId) programmingQuery = programmingQuery.eq("supplier_id", filters.supplierId);
  if (filters.programmingStatus) programmingQuery = programmingQuery.eq("status", filters.programmingStatus);
  const programmingResult = await programmingQuery;
  if (programmingResult.error) throw new Error(`No fue posible cargar las Programaciones. ${programmingResult.error.message}`);
  const programs = (programmingResult.data ?? []) as Row[]; if (!programs.length) return blank;
  const programmingIds = programs.map((p) => String(p.id));
  const dispatchesResult = await supabase.from("dispatches").select("id, project_id, supplier_id, programming_id, status, result, order_number, real_volume, real_unit_code, arrival_at, created_by, created_at").in("programming_id", programmingIds).order("created_at");
  if (dispatchesResult.error) throw new Error(`No fue posible cargar los Despachos relacionados. ${dispatchesResult.error.message}`);
  const dispatches = (dispatchesResult.data ?? []) as Row[]; const dispatchIds = dispatches.map((d) => String(d.id));
  const [guidesResult, incidentsResult] = await Promise.all([
    dispatchIds.length ? supabase.from("dispatch_guides").select("id, project_id, dispatch_id, guide_number, order_number, guide_date, quantity, unit_code").in("dispatch_id", dispatchIds) : empty<Row>(),
    dispatchIds.length ? supabase.from("dispatch_incidents").select("id, dispatch_id").in("dispatch_id", dispatchIds) : empty<{ id: string; dispatch_id: string }>(),
  ]);
  if (guidesResult.error ?? incidentsResult.error) throw new Error("No fue posible resolver Guías e incidencias del reporte.");
  const guides = (guidesResult.data ?? []) as Row[]; const guideIds = guides.map((g) => String(g.id)); const incidentIds = (incidentsResult.data ?? []).map((i) => i.id);
  const [guideDocs, incidentDocs, batchGuides] = await Promise.all([
    guideIds.length ? supabase.from("guide_documents").select("guide_id, document_id").in("guide_id", guideIds) : empty<{ guide_id: string; document_id: string }>(),
    incidentIds.length ? supabase.from("incident_documents").select("incident_id, document_id").in("incident_id", incidentIds) : empty<{ incident_id: string; document_id: string }>(),
    guideIds.length ? supabase.from("batch_guides").select("guide_id, batch_id").in("guide_id", guideIds).is("removed_at", null) : empty<{ guide_id: string; batch_id: string }>(),
  ]);
  if (guideDocs.error ?? incidentDocs.error ?? batchGuides.error) throw new Error("No fue posible resolver el expediente de los Despachos.");
  const supplierIds = [...new Set(programs.map((p) => String(p.supplier_id)))]; const creatorIds = [...new Set([...programs.map((p) => String(p.created_by)), ...dispatches.map((d) => String(d.created_by))])]; const batchIds = [...new Set((batchGuides.data ?? []).map((b) => b.batch_id))];
  const [suppliers, profiles, batches] = await Promise.all([
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : empty<{ id: string; name: string }>(),
    creatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", creatorIds) : empty<{ id: string; full_name: string | null }>(),
    batchIds.length ? supabase.from("batches").select("id, code").in("id", batchIds) : empty<{ id: string; code: string }>(),
  ]);
  if (suppliers.error ?? profiles.error ?? batches.error) throw new Error("No fue posible completar los datos principales de Reportería.");
  const batchByGuide = new Map((batchGuides.data ?? []).map((b) => [b.guide_id, b.batch_id])); const batchMap = new Map((batches.data ?? []).map((b) => [b.id, b.code]));
  const ordersResult = batchIds.length ? await supabase.from("reconciliation_orders").select("id, project_id, batch_id, normalized_order_number, reconciliation_status").in("batch_id", batchIds) : { data: [], error: null };
  if (ordersResult.error) throw new Error("No fue posible resolver los Pedidos del reporte.");
  const orders = ordersResult.data ?? []; const orderIds = orders.map((o) => o.id);
  const [orderRelations, orderLines] = await Promise.all([
    orderIds.length ? supabase.from("reconciliation_order_invoices").select("reconciliation_order_id, invoice_id").in("reconciliation_order_id", orderIds) : empty<{ reconciliation_order_id: string; invoice_id: string }>(),
    orderIds.length ? supabase.from("reconciliation_order_lines").select("reconciliation_order_id, unit_code, invoiced_total").in("reconciliation_order_id", orderIds) : empty<{ reconciliation_order_id: string; unit_code: string | null; invoiced_total: number | string }>(),
  ]);
  if (orderRelations.error ?? orderLines.error) throw new Error("No fue posible resolver la conciliación del reporte.");
  const invoiceIds = [...new Set((orderRelations.data ?? []).map((r) => r.invoice_id))]; const invoiceResult = invoiceIds.length ? await supabase.from("invoices").select("id, invoice_type, status, replaces_invoice_id").in("id", invoiceIds) : { data: [], error: null };
  if (invoiceResult.error) throw new Error("No fue posible resolver el estado de las Facturas.");

  const suppliersMap = new Map((suppliers.data ?? []).map((s) => [s.id, s.name])); const profilesMap = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Usuario no disponible"])); const dispatchByProgram = new Map<string, Row[]>(); for (const d of dispatches) dispatchByProgram.set(String(d.programming_id), [...(dispatchByProgram.get(String(d.programming_id)) ?? []), d]); const guideByDispatch = new Map<string, Row[]>(); for (const guide of guides) guideByDispatch.set(String(guide.dispatch_id), [...(guideByDispatch.get(String(guide.dispatch_id)) ?? []), guide]);
  const incidentsByDispatch = new Map<string, string[]>(); for (const i of incidentsResult.data ?? []) incidentsByDispatch.set(i.dispatch_id, [...(incidentsByDispatch.get(i.dispatch_id) ?? []), i.id]); const guideDocCount = new Map<string, number>(); for (const d of guideDocs.data ?? []) guideDocCount.set(d.guide_id, (guideDocCount.get(d.guide_id) ?? 0) + 1); const incidentDocCount = new Map<string, number>(); for (const d of incidentDocs.data ?? []) incidentDocCount.set(d.incident_id, (incidentDocCount.get(d.incident_id) ?? 0) + 1);
  const orderMap = new Map(orders.map((o) => [`${o.project_id}:${o.batch_id}:${o.normalized_order_number}`, o])); const relationMap = new Map<string, string[]>(); for (const r of orderRelations.data ?? []) relationMap.set(r.reconciliation_order_id, [...(relationMap.get(r.reconciliation_order_id) ?? []), r.invoice_id]); const invoiceMap = new Map((invoiceResult.data ?? []).map((i) => [i.id, i])); const invoicedMap = new Map<string, number>(); for (const l of orderLines.data ?? []) invoicedMap.set(`${l.reconciliation_order_id}:${l.unit_code ?? ""}`, (invoicedMap.get(`${l.reconciliation_order_id}:${l.unit_code ?? ""}`) ?? 0) + numeric(l.invoiced_total));

  let programming: ProgrammingReportItem[] = programs.map((program) => {
    const project = projectMap.get(String(program.project_id)); const programDispatches = dispatchByProgram.get(String(program.id)) ?? [];
    let children: GuideReportRow[] = programDispatches.flatMap((dispatch) => {
      const dispatchGuides = guideByDispatch.get(String(dispatch.id)) ?? [];
      return (dispatchGuides.length ? dispatchGuides : [undefined]).map((guide) => {
        const guideId = String(guide?.id ?? `dispatch:${dispatch.id}`);
        const batchId = guide ? batchByGuide.get(String(guide.id)) ?? null : null;
        const orderNumber = normalizeOrder(dispatch.order_number);
        const order = batchId && orderNumber
          ? orderMap.get(`${program.project_id}:${batchId}:${orderNumber}`)
          : undefined;
        const relatedInvoices = order ? relationMap.get(order.id) ?? [] : [];
        const productInvoices = relatedInvoices
          .map((id) => invoiceMap.get(id))
          .filter((invoice) => invoice?.invoice_type === "PRODUCT");
        const currentProduct = productInvoices.filter(
          (invoice) => !["SUPERSEDED", "CANCELLED"].includes(invoice!.status),
        );
        const unit = String(guide?.unit_code ?? program.unit_code ?? "");
        const invoiced = order ? invoicedMap.get(`${order.id}:${unit}`) ?? 0 : 0;
        const documented = numeric(guide?.quantity);
        const incidentList = incidentsByDispatch.get(String(dispatch.id)) ?? [];
        const orderStatus = effectiveOrderStatus(
          order?.reconciliation_status ?? null,
          currentProduct.length > 0,
        );
        const reinvoicingRequired = orderStatus === "REINVOICING"
          || productInvoices.some(
            (invoice) => invoice?.status === "REINVOICING" || invoice?.replaces_invoice_id,
          );
        return {
          guideId,
          dispatchId: String(dispatch.id),
          projectId: String(program.project_id),
          projectName: project?.name ?? "Proyecto",
          timezone: project?.timezone ?? "America/Guatemala",
          guideNumber: String(guide?.guide_number ?? "Sin guía"),
          guideDate: String(guide?.guide_date ?? String(program.scheduled_at).slice(0, 10)),
          guideTime: dispatch.arrival_at ? String(dispatch.arrival_at) : null,
          supplierId: String(program.supplier_id),
          supplierName: suppliersMap.get(String(program.supplier_id)) ?? "Proveedor no disponible",
          programmingCode: programmingCode(String(program.id)),
          orderNumber,
          batchId,
          batchCode: batchId ? batchMap.get(batchId) ?? null : null,
          documentedQuantity: documented,
          unitCode: unit,
          receivedQuantity: documented,
          physicalResult: String(dispatch.result ?? "PENDING"),
          dispatchStatus: String(dispatch.status),
          registeredById: String(dispatch.created_by),
          registeredByName: profilesMap.get(String(dispatch.created_by)) ?? "Usuario no disponible",
          createdAt: String(dispatch.created_at),
          incidentCount: incidentList.length,
          documentCount: (guideDocCount.get(guideId) ?? 0)
            + incidentList.reduce((sum, id) => sum + (incidentDocCount.get(id) ?? 0), 0),
          orderStatus,
          reinvoicingRequired,
          reconciliationStatus: order?.reconciliation_status ?? "WITHOUT_ORDER",
          productInvoicedQuantity: invoiced,
          difference: invoiced - documented,
          invoiceCount: relatedInvoices.length,
        };
      });
    });
    if (filters.orderNumber) children = children.filter((d) => d.orderNumber?.toLowerCase().includes(filters.orderNumber!.toLowerCase())); if (filters.batchId) children = children.filter((d) => d.batchId === filters.batchId); if (filters.dispatchStatus) children = children.filter((d) => d.dispatchStatus === filters.dispatchStatus); if (filters.orderStatus) children = children.filter((d) => filters.orderStatus === "REINVOICING" ? d.reinvoicingRequired : d.orderStatus === filters.orderStatus); if (filters.reconciliationStatus) children = children.filter((d) => d.reconciliationStatus === filters.reconciliationStatus); if (filters.withIncidents === "yes") children = children.filter((d) => d.incidentCount > 0); if (filters.withIncidents === "no") children = children.filter((d) => d.incidentCount === 0);
    return { id: String(program.id), code: programmingCode(String(program.id)), projectId: String(program.project_id), projectName: project?.name ?? "Proyecto", timezone: project?.timezone ?? "America/Guatemala", supplierId: String(program.supplier_id), supplierName: suppliersMap.get(String(program.supplier_id)) ?? "Proveedor no disponible", scheduledAt: String(program.scheduled_at), requestedQuantity: numeric(program.requested_quantity), confirmedQuantity: program.confirmed_quantity === null ? null : numeric(program.confirmed_quantity), unitCode: String(program.unit_code), status: String(program.status), createdById: String(program.created_by), createdByName: profilesMap.get(String(program.created_by)) ?? "Usuario no disponible", dispatches: children };
  });
  if (hasDispatchFilters(filters)) programming = programming.filter((p) => p.dispatches.length > 0); if (filters.userId) programming = programming.filter((p) => p.createdById === filters.userId || p.dispatches.some((d) => d.registeredById === filters.userId));
  const rows = programming.flatMap((p) => p.dispatches);
  return { rows, programming, filters: { projects: options(projects.map((p) => [p.id, p.name])), suppliers: options([...suppliersMap.entries()]), users: options([...profilesMap.entries()]), batches: options((batches.data ?? []).map((b) => [b.id, b.code])) } };
}
