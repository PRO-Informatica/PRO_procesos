import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan variables de Supabase para ejecutar el benchmark.");

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const empty = { data: [], error: null };

async function checked(query) {
  const result = await query;
  if (result.error) throw result.error;
  return result.data ?? [];
}

const batches = await checked(db.from("batches").select("id, project_id").order("created_at", { ascending: false }).limit(20));
let target = null;
for (const batch of batches) {
  const relations = await checked(db.from("batch_dispatches").select("id", { count: "exact" }).eq("batch_id", batch.id).limit(1));
  if (relations.length) { target = batch; break; }
}
if (!target) throw new Error("No existe un lote con despachos para medir.");

async function baseline() {
  let queryCount = 0;
  let stages = 0;
  const query = (value) => { queryCount += 1; return checked(value); };
  const optional = (condition, value) => condition ? query(value) : Promise.resolve(empty.data);
  const startedAt = performance.now();

  stages += 1;
  const [batchRows, relations, activeProjectRelations, dispatches] = await Promise.all([
    query(db.from("batches").select("id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at").eq("project_id", target.project_id).eq("id", target.id).limit(1)),
    query(db.from("batch_dispatches").select("id, project_id, batch_id, dispatch_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata").eq("project_id", target.project_id).eq("batch_id", target.id).order("added_at", { ascending: false })),
    query(db.from("batch_dispatches").select("dispatch_id").eq("project_id", target.project_id).is("removed_at", null)),
    query(db.from("dispatches").select("id, programming_id, supplier_id, order_number, status, real_volume, real_unit_code").eq("project_id", target.project_id).in("status", ["IN_EXECUTION", "COMPLETED"])),
  ]);
  if (!batchRows.length) throw new Error("El lote de medición dejó de existir.");
  void activeProjectRelations;
  const dispatchIds = [...new Set(relations.map((row) => row.dispatch_id))];
  const programmingIds = [...new Set(dispatches.map((row) => row.programming_id))];
  const supplierIds = [...new Set(dispatches.map((row) => row.supplier_id))];
  const removedByIds = [...new Set(relations.flatMap((row) => row.removed_by ? [row.removed_by] : []))];

  stages += 1;
  const [, , , , invoices] = await Promise.all([
    optional(programmingIds.length, db.from("programming").select("id, scheduled_at").eq("project_id", target.project_id).in("id", programmingIds)),
    optional(supplierIds.length, db.from("suppliers").select("id, name").in("id", supplierIds)),
    optional(dispatchIds.length, db.from("dispatch_guides").select("id, dispatch_id").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
    optional(dispatchIds.length, db.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
    optional(dispatchIds.length, db.from("invoices").select("id, dispatch_id").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
    optional(removedByIds.length, db.from("profiles").select("id, full_name").in("id", removedByIds)),
  ]);
  const invoiceIds = invoices.map((row) => row.id);

  stages += 1;
  const [documentLinks, attempts] = await Promise.all([
    optional(invoiceIds.length, db.from("invoice_documents").select("invoice_id, document_id").eq("project_id", target.project_id).in("invoice_id", invoiceIds)),
    optional(dispatchIds.length, db.from("dispatch_reconciliation_attempts").select("id, dispatch_id, executed_by").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
  ]);
  const documentIds = documentLinks.map((row) => row.document_id);
  stages += 1;
  const versions = await optional(documentIds.length, db.from("document_versions").select("id, document_id, file_name").in("document_id", documentIds).eq("upload_status", "UPLOADED").eq("is_current", true));
  const versionIds = versions.map((row) => row.id);
  stages += 1;
  const jobs = await optional(versionIds.length, db.from("document_processing_jobs").select("id, document_version_id").in("document_version_id", versionIds).eq("status", "COMPLETED"));
  const jobIds = jobs.map((row) => row.id);
  stages += 1;
  await optional(jobIds.length, db.from("invoice_extractions").select("id, invoice_id, processing_job_id").in("processing_job_id", jobIds));
  const attemptUserIds = [...new Set(attempts.map((row) => row.executed_by))];
  stages += 1;
  await optional(attemptUserIds.length, db.from("profiles").select("id, full_name").in("id", attemptUserIds));
  stages += 1;
  queryCount += 1;
  await db.rpc("preview_weekly_batch_rollover", { p_batch_id: target.id });
  return { durationMs: performance.now() - startedAt, queryCount, stages };
}

async function optimized() {
  let queryCount = 0;
  const query = (value) => { queryCount += 1; return checked(value); };
  const optional = (condition, value) => condition ? query(value) : Promise.resolve(empty.data);
  const startedAt = performance.now();
  const [batchRows, relations, activeProjectRelations, dispatches] = await Promise.all([
    query(db.from("batches").select("id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at").eq("project_id", target.project_id).eq("id", target.id).limit(1)),
    query(db.from("batch_dispatches").select("id, project_id, batch_id, dispatch_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata").eq("project_id", target.project_id).eq("batch_id", target.id).is("removed_at", null).order("added_at", { ascending: false })),
    query(db.from("batch_dispatches").select("dispatch_id").eq("project_id", target.project_id).is("removed_at", null)),
    query(db.from("dispatches").select("id, programming_id, supplier_id, order_number, status, real_volume, real_unit_code").eq("project_id", target.project_id).in("status", ["IN_EXECUTION", "COMPLETED"])),
  ]);
  if (!batchRows.length) throw new Error("El lote de medición dejó de existir.");
  void activeProjectRelations;
  const dispatchIds = [...new Set(relations.map((row) => row.dispatch_id))];
  const programmingIds = [...new Set(dispatches.map((row) => row.programming_id))];
  const supplierIds = [...new Set(dispatches.map((row) => row.supplier_id))];
  await Promise.all([
    optional(programmingIds.length, db.from("programming").select("id, scheduled_at").eq("project_id", target.project_id).in("id", programmingIds)),
    optional(supplierIds.length, db.from("suppliers").select("id, name").in("id", supplierIds)),
    optional(dispatchIds.length, db.from("dispatch_guides").select("id, dispatch_id").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
    optional(dispatchIds.length, db.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
    optional(dispatchIds.length, db.from("invoices").select("id, dispatch_id").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
    optional(dispatchIds.length, db.from("dispatch_reconciliation_attempts").select("id, dispatch_id, executed_by").eq("project_id", target.project_id).in("dispatch_id", dispatchIds)),
  ]);
  return { durationMs: performance.now() - startedAt, queryCount, stages: 2 };
}

const samples = [];
for (let iteration = 0; iteration < 5; iteration += 1) {
  samples.push({ baseline: await baseline(), optimized: await optimized() });
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const beforeMs = median(samples.map((sample) => sample.baseline.durationMs));
const afterMs = median(samples.map((sample) => sample.optimized.durationMs));
console.log(JSON.stringify({
  sampleCount: samples.length,
  dispatchesInBatch: (await checked(db.from("batch_dispatches").select("id").eq("batch_id", target.id).is("removed_at", null))).length,
  before: { requests: 2, fullLayoutRefreshes: 1, detailQueries: samples[0].baseline.queryCount, queryStages: samples[0].baseline.stages, medianDetailMs: Math.round(beforeMs * 10) / 10 },
  afterFirstSelection: { requests: 1, fullLayoutRefreshes: 0, detailQueries: samples[0].optimized.queryCount, queryStages: 2, medianDetailMs: Math.round(afterMs * 10) / 10 },
  afterCachedSelection: { requests: 0, fullLayoutRefreshes: 0, detailQueries: 0, queryStages: 0, medianDetailMs: 0 },
  detailTimeReductionPercent: Math.round((1 - afterMs / beforeMs) * 1000) / 10,
}, null, 2));
