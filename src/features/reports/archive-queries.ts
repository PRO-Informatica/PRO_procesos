import type { SupabaseClient } from "@supabase/supabase-js";

import type { GuideReportRow } from "./types";
import type { ReportEvidence } from "./export-utils";

const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 100;

// Supabase's response limit must not silently truncate a dispatch's evidence.
export async function readArchiveRows<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>) {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const result = await query(start, start + PAGE_SIZE - 1);
    if (result.error) throw new Error("No fue posible consultar los adjuntos del reporte.");
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

export function archiveIdChunks(ids: string[]) {
  const result: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK_SIZE) result.push(ids.slice(offset, offset + ID_CHUNK_SIZE));
  return result;
}

// `dispatches` MUST come from the server's filtered/authorized report, never
// from a client-supplied order number. All metadata queries use session RLS.
export async function getReportEvidence(client: SupabaseClient, dispatches: Pick<GuideReportRow, "projectId" | "dispatchId">[]) {
  const byProject = new Map<string, Set<string>>();
  for (const row of dispatches) {
    const ids = byProject.get(row.projectId) ?? new Set<string>();
    ids.add(row.dispatchId);
    byProject.set(row.projectId, ids);
  }
  const evidence: ReportEvidence[] = [];
  for (const [projectId, dispatchIds] of byProject) {
    for (const ids of archiveIdChunks([...dispatchIds])) {
      const [direct, guides, incidents] = await Promise.all([
        readArchiveRows((from, to) => client.from("dispatch_documents").select("dispatch_id, document_id")
          .eq("project_id", projectId).in("dispatch_id", ids).order("dispatch_id").order("document_id").range(from, to)),
        readArchiveRows((from, to) => client.from("dispatch_guides").select("id, dispatch_id, guide_number")
          .eq("project_id", projectId).in("dispatch_id", ids).order("id").range(from, to)),
        readArchiveRows((from, to) => client.from("dispatch_incidents").select("id, dispatch_id")
          .eq("project_id", projectId).in("dispatch_id", ids).order("id").range(from, to)),
      ]);
      for (const document of direct) evidence.push({ projectId, dispatchId: document.dispatch_id,
        documentId: document.document_id, context: "dispatch", contextId: document.dispatch_id });
      const guideById = new Map(guides.map((guide) => [guide.id, guide]));
      const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
      for (const guideIds of archiveIdChunks([...guideById.keys()])) {
        const documents = await readArchiveRows((from, to) => client.from("guide_documents").select("guide_id, document_id")
          .eq("project_id", projectId).in("guide_id", guideIds).order("guide_id").order("document_id").range(from, to));
        for (const document of documents) {
          const guide = guideById.get(document.guide_id);
          if (guide) evidence.push({ projectId, dispatchId: guide.dispatch_id, documentId: document.document_id,
            context: "guide", contextId: guide.id, guideNumber: guide.guide_number });
        }
      }
      for (const incidentIds of archiveIdChunks([...incidentById.keys()])) {
        const documents = await readArchiveRows((from, to) => client.from("incident_documents").select("incident_id, document_id")
          .eq("project_id", projectId).in("incident_id", incidentIds).order("incident_id").order("document_id").range(from, to));
        for (const document of documents) {
          const incident = incidentById.get(document.incident_id);
          if (incident) evidence.push({ projectId, dispatchId: incident.dispatch_id, documentId: document.document_id,
            context: "incident", contextId: incident.id });
        }
      }
    }
  }
  return evidence;
}
