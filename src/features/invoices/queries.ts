import "server-only";

import { formatProgrammingCode } from "@/features/batches/formatters";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { GlobalInvoiceData, GlobalInvoiceItem } from "./types";

function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

export async function getGlobalInvoices(projectId: string): Promise<GlobalInvoiceData> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const [invoicesResult, suppliersResult, batchesResult, relationsResult, dispatchesResult] = await Promise.all([
    supabase.from("invoices").select("id, dispatch_id, supplier_id, invoice_type, invoice_number, invoice_date, total, currency, status, replaces_invoice_id, order_number, pca_original, created_by, created_at").eq("project_id", projectId).order("invoice_date", { ascending: false }).limit(1000),
    supabase.from("suppliers").select("id, name"),
    supabase.from("batches").select("id, code").eq("project_id", projectId).order("period_start", { ascending: false }),
    supabase.from("batch_dispatches").select("batch_id, dispatch_id").eq("project_id", projectId).is("removed_at", null),
    supabase.from("dispatches").select("id, programming_id").eq("project_id", projectId),
  ]);
  const error = invoicesResult.error ?? suppliersResult.error ?? batchesResult.error ?? relationsResult.error ?? dispatchesResult.error;
  if (error) throw new Error(`No fue posible cargar Facturas. ${error.message}`);
  const invoices = invoicesResult.data ?? [];
  const invoiceIds = invoices.map((row) => row.id);
  const creatorIds = [...new Set(invoices.map((row) => row.created_by))];
  const [documentsResult, creatorsResult] = await Promise.all([
    invoiceIds.length ? admin.from("invoice_documents").select("invoice_id, document_id").eq("project_id", projectId).in("invoice_id", invoiceIds) : Promise.resolve({ data: [], error: null }),
    creatorIds.length ? admin.from("profiles").select("id, full_name").in("id", creatorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (documentsResult.error ?? creatorsResult.error) throw new Error("No fue posible resolver documentos o autores de factura.");
  const documentIds = (documentsResult.data ?? []).map((row) => row.document_id);
  const versionsResult = documentIds.length ? await admin.from("document_versions").select("id, document_id, file_name").in("document_id", documentIds).eq("upload_status", "UPLOADED").eq("is_current", true) : { data: [], error: null };
  const versionIds = (versionsResult.data ?? []).map((row) => row.id);
  const jobsResult = versionIds.length ? await admin.from("document_processing_jobs").select("id, document_version_id").in("document_version_id", versionIds).order("created_at", { ascending: false }) : { data: [], error: null };
  const jobIds = (jobsResult.data ?? []).map((row) => row.id);
  const extractionResult = jobIds.length ? await admin.from("invoice_extractions").select("processing_job_id, verification_status").in("processing_job_id", jobIds).order("created_at", { ascending: false }) : { data: [], error: null };
  if (versionsResult.error ?? jobsResult.error ?? extractionResult.error) throw new Error("No fue posible resolver el procesamiento de facturas.");

  const suppliers = new Map((suppliersResult.data ?? []).map((row) => [row.id, row.name]));
  const batches = new Map((batchesResult.data ?? []).map((row) => [row.id, row.code]));
  const relationByDispatch = new Map((relationsResult.data ?? []).map((row) => [row.dispatch_id, row.batch_id]));
  const dispatches = new Map((dispatchesResult.data ?? []).map((row) => [row.id, row]));
  const documentByInvoice = new Map((documentsResult.data ?? []).map((row) => [row.invoice_id, row.document_id]));
  const versionByDocument = new Map((versionsResult.data ?? []).map((row) => [row.document_id, row]));
  const jobByVersion = new Map<string, string>();
  for (const row of jobsResult.data ?? []) if (!jobByVersion.has(row.document_version_id)) jobByVersion.set(row.document_version_id, row.id);
  const extractionByJob = new Map<string, GlobalInvoiceItem["extractionStatus"]>();
  for (const row of extractionResult.data ?? []) if (!extractionByJob.has(row.processing_job_id)) extractionByJob.set(row.processing_job_id, row.verification_status as GlobalInvoiceItem["extractionStatus"]);
  const creators = new Map((creatorsResult.data ?? []).map((row) => [row.id, row.full_name]));

  return { batches: batchesResult.data ?? [], items: invoices.map((invoice) => {
    const batchId = relationByDispatch.get(invoice.dispatch_id) ?? null;
    const documentId = documentByInvoice.get(invoice.id) ?? null;
    const version = documentId ? versionByDocument.get(documentId) : undefined;
    const jobId = version ? jobByVersion.get(version.id) : undefined;
    const dispatch = dispatches.get(invoice.dispatch_id);
    return {
      id: invoice.id, number: invoice.invoice_number, type: invoice.invoice_type,
      status: invoice.status, date: invoice.invoice_date, total: numeric(invoice.total),
      currency: invoice.currency, supplierName: suppliers.get(invoice.supplier_id) ?? "Proveedor no disponible",
      pcaOriginal: invoice.pca_original, orderNumber: invoice.order_number,
      dispatchId: invoice.dispatch_id,
      programmingCode: dispatch ? formatProgrammingCode(dispatch.programming_id) : "Despacho",
      batchId, batchCode: batchId ? batches.get(batchId) ?? null : null,
      replacesInvoiceId: invoice.replaces_invoice_id,
      replacedByInvoiceId: invoices.find((row) => row.replaces_invoice_id === invoice.id)?.id ?? null,
      documentId, fileName: version?.file_name ?? null,
      extractionStatus: jobId ? extractionByJob.get(jobId) ?? null : null,
      createdByName: creators.get(invoice.created_by) || "Usuario no disponible",
      createdAt: invoice.created_at,
    };
  }) };
}
