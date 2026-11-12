import "server-only";
import { getDispatchBillingCompletion } from "@/features/dispatches/billing-completion-queries";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { guideReportMetadata } from "./guide-metadata";
import type { ReportProjectInput } from "./queries";
import { filterRadarDispatches, makeRadarGuide, radarQueryDateRange, type RadarData, type RadarDispatch, type RadarFilters } from "./radar";
import type { DispatchReportSummary } from "./types";

type Row = Record<string, unknown>;
const PAGE_SIZE = 500;
function chunks(ids: string[]) {
  return Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));
}
function ids(rows: Row[], key: string) { return [...new Set(rows.flatMap((row) => typeof row[key] === "string" && row[key] ? [row[key] as string] : []))]; }
function group(rows: Row[], key: string) {
  const result = new Map<string, Row[]>();
  for (const row of rows) { const id = String(row[key]); result.set(id, [...(result.get(id) ?? []), row]); }
  return result;
}
function index(rows: Row[]) { return new Map(rows.map((row) => [String(row.id), row])); }
function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
async function readRows(query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await query(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error("No fue posible cargar los despachos del radar de fundición.");
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function getCastingRadar(projects: ReportProjectInput[], filters: RadarFilters): Promise<RadarData> {
  const data: RadarData = { dispatches: [], projects: projects.map((project) => ({ value: project.id, label: `${project.name} · ${project.code}` })) };
  const allowedIds = new Set(projects.map((project) => project.id));
  const projectIds = filters.projectId ? allowedIds.has(filters.projectId) ? [filters.projectId] : [] : [...allowedIds];
  if (!projectIds.length) return data;
  const supabase = await createClient();
  const range = radarQueryDateRange(filters);
  const programs: Row[] = [];
  // Start from the dispatch's programming, including dispatches without guides.
  for (const batch of chunks(projectIds)) {
    programs.push(...await readRows((from, to) => supabase.from("programming").select("id, project_id, scheduled_at, casting_element, unit_code").in("project_id", batch).gte("scheduled_at", `${range.dateFrom}T00:00:00Z`).lte("scheduled_at", `${range.dateTo}T23:59:59.999Z`).order("id").range(from, to)));
  }
  const dispatches: Row[] = [];
  for (const batch of chunks(ids(programs, "id"))) {
    dispatches.push(...await readRows((from, to) => supabase.from("dispatches").select("id, project_id, supplier_id, programming_id, order_number, status, real_volume, real_unit_code, completed_by").in("programming_id", batch).in("project_id", projectIds).order("id").range(from, to)));
  }
  if (!dispatches.length) return data;
  const guides: Row[] = [], incidents: Row[] = [], relations: Row[] = [], reconciliations: Row[] = [], attempts: Row[] = [];
  for (const batch of chunks(ids(dispatches, "id"))) {
    const results = await Promise.all([
      readRows((from, to) => supabase.from("dispatch_guides").select("id, dispatch_id, guide_number, guide_date, truck_arrival_at, truck_departure_at, casting_element, laboratory_applied, details").in("dispatch_id", batch).in("project_id", projectIds).order("id").range(from, to)),
      readRows((from, to) => supabase.from("dispatch_incidents").select("id, dispatch_id").in("dispatch_id", batch).in("project_id", projectIds).order("id").range(from, to)),
      readRows((from, to) => supabase.from("batch_dispatches").select("dispatch_id, batch_id").in("dispatch_id", batch).in("project_id", projectIds).is("removed_at", null).order("dispatch_id").order("batch_id").range(from, to)),
      readRows((from, to) => supabase.from("dispatch_reconciliations").select("dispatch_id, status, current_product_invoice_id, current_service_invoice_id").in("dispatch_id", batch).in("project_id", projectIds).order("dispatch_id").range(from, to)),
      readRows((from, to) => supabase.from("dispatch_reconciliation_attempts").select("id, dispatch_id, difference, executed_at").in("dispatch_id", batch).in("project_id", projectIds).order("executed_at", { ascending: false }).order("id").range(from, to)),
    ]);
    guides.push(...results[0]); incidents.push(...results[1]); relations.push(...results[2]); reconciliations.push(...results[3]); attempts.push(...results[4]);
  }
  const [suppliers, batches, lines, invoiceRows, actors, billingCompletion] = await Promise.all([
    Promise.all(chunks(ids(dispatches, "supplier_id")).map((batch) => readRows((from, to) => supabase.from("suppliers").select("id, name").in("id", batch).order("id").range(from, to)))).then((rows) => rows.flat()),
    Promise.all(chunks(ids(relations, "batch_id")).map((batch) => readRows((from, to) => supabase.from("batches").select("id, code").in("id", batch).in("project_id", projectIds).order("id").range(from, to)))).then((rows) => rows.flat()),
    Promise.all(chunks(ids(guides, "id")).map((batch) => readRows((from, to) => supabase.from("dispatch_guide_lines").select("id, guide_id, position, product_code, product_description, quantity, unit_code, catalog_type, catalog_reference").in("guide_id", batch).in("project_id", projectIds).order("id").range(from, to)))).then((rows) => rows.flat()),
    Promise.all(chunks([...new Set([...ids(reconciliations, "current_product_invoice_id"), ...ids(reconciliations, "current_service_invoice_id")])]).map((batch) => readRows((from, to) => supabase.from("invoices").select("id, invoice_number, total, currency").in("id", batch).in("project_id", projectIds).order("id").range(from, to)))).then((rows) => rows.flat()),
    ids(dispatches, "completed_by").length ? supabase.rpc("get_report_actor_labels", { p_project_ids: projectIds }) : Promise.resolve({ data: [], error: null }),
    getDispatchBillingCompletion(projectIds),
  ]);
  if (actors.error) throw new Error("No fue posible resolver los responsables de los despachos.");
  // Restrict privileged extraction reads to invoices from authorized dispatches.
  const extractions: Row[] = [];
  if (invoiceRows.length) {
    const admin = createAdminClient();
    for (const batch of chunks(ids(invoiceRows, "id"))) {
      extractions.push(...await readRows((from, to) => admin.from("invoice_extractions").select("id, invoice_id, verification_status, created_at").in("invoice_id", batch).order("created_at", { ascending: false }).order("id").range(from, to)));
    }
  }
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const programMap = index(programs), supplierMap = index(suppliers), batchMap = index(batches), invoiceMap = index(invoiceRows);
  const actorsMap = new Map<string, string>((actors.data ?? []).map((actor: { profile_id: string; display_label: string }) => [actor.profile_id, actor.display_label]));
  const guidesByDispatch = group(guides, "dispatch_id"), linesByGuide = group(lines, "guide_id"), incidentsByDispatch = group(incidents, "dispatch_id");
  const reconciliationMap = new Map(reconciliations.map((row) => [String(row.dispatch_id), row]));
  const relationMap = new Map(relations.map((row) => [String(row.dispatch_id), row]));
  const attemptsByDispatch = group(attempts, "dispatch_id"), extractionsByInvoice = group(extractions, "invoice_id");
  function invoice(id: unknown): DispatchReportSummary["productInvoice"] {
    const row = invoiceMap.get(String(id));
    return row ? { number: String(row.invoice_number), total: numeric(row.total), currency: String(row.currency), extractionStatus: String(extractionsByInvoice.get(String(id))?.[0]?.verification_status ?? "") || null } : null;
  }
  const mapped: RadarDispatch[] = dispatches.flatMap((dispatch) => {
    const project = projectMap.get(String(dispatch.project_id)), program = programMap.get(String(dispatch.programming_id));
    if (!project || !program || program.project_id !== project.id) return [];
    const id = String(dispatch.id), code = `DSP-${id.slice(0, 8).toUpperCase()}`;
    const dispatchGuides = guidesByDispatch.get(id) ?? [], reconciliation = reconciliationMap.get(id);
    const completed = dispatch.status === "COMPLETED" && dispatch.completed_by;
    return [{
      id, code, programmingCode: `PRG-${String(dispatch.programming_id).slice(0, 8).toUpperCase()}`,
      orderNumber: String(dispatch.order_number ?? ""), projectId: project.id, projectName: project.name,
      supplierName: String(supplierMap.get(String(dispatch.supplier_id))?.name ?? "Proveedor"), scheduledAt: String(program.scheduled_at), timezone: project.timezone,
      summary: {
        dispatchId: id, dispatchCode: code, projectId: project.id, orderNumber: String(dispatch.order_number ?? "") || null,
        batchCode: String(batchMap.get(String(relationMap.get(id)?.batch_id))?.code ?? "") || null,
        receivedQuantity: numeric(dispatch.real_volume), unitCode: String(dispatch.real_unit_code ?? program.unit_code ?? ""),
        guideCount: dispatchGuides.length, incidentCount: incidentsByDispatch.get(id)?.length ?? 0,
        ...guideReportMetadata(dispatchGuides, program.casting_element), dispatchStatus: String(dispatch.status),
        completedByName: completed ? actorsMap.get(String(dispatch.completed_by)) ?? "Usuario no disponible" : null,
        billingComplete: billingCompletion[id] === true,
        reconciliationStatus: String(reconciliation?.status ?? "NOT_STARTED"), difference: numeric(attemptsByDispatch.get(id)?.[0]?.difference),
        productInvoice: invoice(reconciliation?.current_product_invoice_id), serviceInvoice: invoice(reconciliation?.current_service_invoice_id),
      },
      guides: dispatchGuides.map((guide) => makeRadarGuide(guide, linesByGuide.get(String(guide.id)) ?? [], program.casting_element)).sort((a, b) => a.date.localeCompare(b.date) || (a.arrivalAt ?? "").localeCompare(b.arrivalAt ?? "") || a.number.localeCompare(b.number)),
    }];
  });
  data.dispatches = filterRadarDispatches(mapped, filters).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt) || a.code.localeCompare(b.code));
  return data;
}
