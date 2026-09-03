import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DocumentFilters, GlobalDocumentsData } from "./types";

type ProjectInput = { id: string; name: string };
const empty = <T,>() => Promise.resolve({ data: [] as T[], error: null });

export async function getGlobalDocuments(projects: ProjectInput[], filters: DocumentFilters): Promise<GlobalDocumentsData> {
  const supabase = await createClient();
  const allowed = new Set(projects.map((p) => p.id));
  const projectIds = filters.projectId && allowed.has(filters.projectId) ? [filters.projectId] : projects.map((p) => p.id);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  if (!projectIds.length) return { documents: [], projects: [], users: [] };
  let query = supabase.from("documents").select("id, project_id, category, created_by, created_at").in("project_id", projectIds).order("created_at", { ascending: false }).limit(3000);
  if (filters.type) query = query.eq("category", filters.type);
  if (filters.dateFrom) query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
  if (filters.dateTo) query = query.lte("created_at", `${filters.dateTo}T23:59:59.999`);
  const documentsResult = await query;
  if (documentsResult.error) throw new Error(`No fue posible cargar Documentos. ${documentsResult.error.message}`);
  const documents = documentsResult.data ?? [];
  const ids = documents.map((d) => d.id);
  const creatorIds = [...new Set(documents.map((d) => d.created_by))];
  const [versions, guides, incidents, invoices, profiles] = await Promise.all([
    ids.length ? supabase.from("document_versions").select("document_id, file_name, mime_type, upload_status, created_at").in("document_id", ids).eq("is_current", true) : empty<{ document_id: string; file_name: string; mime_type: string; upload_status: string; created_at: string }>(),
    ids.length ? supabase.from("guide_documents").select("document_id, guide_id").in("document_id", ids) : empty<{ document_id: string; guide_id: string }>(),
    ids.length ? supabase.from("incident_documents").select("document_id, incident_id").in("document_id", ids) : empty<{ document_id: string; incident_id: string }>(),
    ids.length ? supabase.from("invoice_documents").select("document_id, invoice_id").in("document_id", ids) : empty<{ document_id: string; invoice_id: string }>(),
    creatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", creatorIds) : empty<{ id: string; full_name: string | null }>(),
  ]);
  const error = versions.error ?? guides.error ?? incidents.error ?? invoices.error ?? profiles.error;
  if (error) throw new Error(`No fue posible resolver el contexto documental. ${error.message}`);
  const guideIds = (guides.data ?? []).map((r) => r.guide_id);
  const incidentIds = (incidents.data ?? []).map((r) => r.incident_id);
  const invoiceIds = (invoices.data ?? []).map((r) => r.invoice_id);
  const [guideRows, incidentRows, invoiceRows] = await Promise.all([
    guideIds.length ? supabase.from("dispatch_guides").select("id, dispatch_id, guide_number").in("id", guideIds) : empty<{ id: string; dispatch_id: string; guide_number: string }>(),
    incidentIds.length ? supabase.from("dispatch_incidents").select("id, dispatch_id").in("id", incidentIds) : empty<{ id: string; dispatch_id: string }>(),
    invoiceIds.length ? supabase.from("invoices").select("id, invoice_number, order_number").in("id", invoiceIds) : empty<{ id: string; invoice_number: string; order_number: string | null }>(),
  ]);
  if (guideRows.error ?? incidentRows.error ?? invoiceRows.error) throw new Error("No fue posible resolver Guías, incidencias o Facturas de Documentos.");
  const dispatchIds = [...new Set([...(guideRows.data ?? []).map((row) => row.dispatch_id), ...(incidentRows.data ?? []).map((row) => row.dispatch_id)])];
  const [incidentGuides, dispatchRows] = await Promise.all([
    dispatchIds.length ? supabase.from("dispatch_guides").select("dispatch_id, guide_number").in("dispatch_id", dispatchIds) : empty<{ dispatch_id: string; guide_number: string }>(),
    dispatchIds.length ? supabase.from("dispatches").select("id, order_number").in("id", dispatchIds) : empty<{ id: string; order_number: string | null }>(),
  ]);
  if (incidentGuides.error ?? dispatchRows.error) throw new Error("No fue posible resolver el Despacho de las evidencias.");

  const versionMap = new Map((versions.data ?? []).map((v) => [v.document_id, v]));
  const guideMap = new Map((guideRows.data ?? []).map((g) => [g.id, g]));
  const incidentMap = new Map((incidentRows.data ?? []).map((i) => [i.id, i]));
  const dispatchGuideMap = new Map((incidentGuides.data ?? []).map((g) => [g.dispatch_id, g]));
  const dispatchMap = new Map((dispatchRows.data ?? []).map((row) => [row.id, row]));
  const invoiceMap = new Map((invoiceRows.data ?? []).map((i) => [i.id, i]));
  const guideLink = new Map((guides.data ?? []).map((r) => [r.document_id, r.guide_id]));
  const incidentLink = new Map((incidents.data ?? []).map((r) => [r.document_id, r.incident_id]));
  const invoiceLink = new Map((invoices.data ?? []).map((r) => [r.document_id, r.invoice_id]));
  const profileMap = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Usuario no disponible"]));
  let mapped = documents.flatMap((document) => {
    const version = versionMap.get(document.id);
    if (!version) return [];
    const guide = guideMap.get(guideLink.get(document.id) ?? "");
    const incident = incidentMap.get(incidentLink.get(document.id) ?? "");
    const incidentGuide = incident ? dispatchGuideMap.get(incident.dispatch_id) : undefined;
    const invoice = invoiceMap.get(invoiceLink.get(document.id) ?? "");
    const dispatch = dispatchMap.get(guide?.dispatch_id ?? incident?.dispatch_id ?? "");
    return [{ id: document.id, projectId: document.project_id, projectName: projectNames.get(document.project_id) ?? "Proyecto", name: version.file_name, mimeType: version.mime_type, type: document.category, context: guide ? "GUIDE" : incident ? "INCIDENT" : invoice ? "INVOICE" : "OTHER", orderNumber: dispatch?.order_number ?? invoice?.order_number ?? null, guideNumber: guide?.guide_number ?? incidentGuide?.guide_number ?? null, invoiceNumber: invoice?.invoice_number ?? null, date: version.created_at ?? document.created_at, uploadedById: document.created_by, uploadedBy: profileMap.get(document.created_by) ?? "Usuario no disponible", status: version.upload_status }];
  });
  if (filters.order) mapped = mapped.filter((d) => d.orderNumber?.toLowerCase().includes(filters.order!.toLowerCase()));
  if (filters.guide) mapped = mapped.filter((d) => d.guideNumber?.toLowerCase().includes(filters.guide!.toLowerCase()));
  if (filters.invoice) mapped = mapped.filter((d) => d.invoiceNumber?.toLowerCase().includes(filters.invoice!.toLowerCase()));
  if (filters.userId) mapped = mapped.filter((d) => d.uploadedById === filters.userId);
  return { documents: mapped, projects: projects.map((p) => ({ value: p.id, label: p.name })), users: [...profileMap].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es")) };
}
