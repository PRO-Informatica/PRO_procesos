import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dispatchProducts, matchInvoiceProducts, type DispatchInvoiceIdentity } from "./dispatch-invoice-identity";

const PAGE_SIZE = 500;
function chunks(ids: string[]) {
  return Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, (index + 1) * 100));
}

export async function readInvoiceIdentityRows<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await query(from, from + PAGE_SIZE - 1);
    if (response.error) throw new Error("No fue posible verificar los productos y PCA del despacho. Intenta nuevamente.");
    rows.push(...(response.data ?? []));
    if ((response.data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

// Call only after authorizing projectId. Candidate IDs come from the server's
// project-scoped dispatch query; never from a browser-supplied order/guide ID.
export async function getDispatchInvoiceIdentities(
  client: SupabaseClient,
  projectId: string,
  dispatches: Array<{ id: string; programming_id: string }>,
): Promise<Map<string, DispatchInvoiceIdentity>> {
  const identities = new Map<string, DispatchInvoiceIdentity>();
  if (!dispatches.length) return identities;
  const catalog = await readInvoiceIdentityRows((from, to) => client.from("project_product_prices")
    .select("id, code, reference").eq("project_id", projectId).order("id").range(from, to));
  for (const ids of chunks(dispatches.map((dispatch) => dispatch.id))) {
    const candidates = dispatches.filter((dispatch) => ids.includes(dispatch.id));
    const [guides, programmingLines, reconciliations] = await Promise.all([
      readInvoiceIdentityRows((from, to) => client.from("dispatch_guides").select("id, dispatch_id")
        .eq("project_id", projectId).in("dispatch_id", ids).order("id").range(from, to)),
      readInvoiceIdentityRows((from, to) => client.from("programming_lines").select("id, programming_id, concrete_type")
        .in("programming_id", [...new Set(candidates.map((dispatch) => dispatch.programming_id))]).order("id").range(from, to)),
      readInvoiceIdentityRows((from, to) => client.from("dispatch_reconciliations").select("dispatch_id, current_product_invoice_id")
        .eq("project_id", projectId).in("dispatch_id", ids).order("dispatch_id").range(from, to)),
    ]);
    const guideLines = [];
    for (const guideIds of chunks(guides.map((guide) => guide.id))) {
      guideLines.push(...await readInvoiceIdentityRows((from, to) => client.from("dispatch_guide_lines")
        .select("id, guide_id, catalog_type, product_code, catalog_reference").eq("project_id", projectId)
        .in("guide_id", guideIds).order("id").range(from, to)));
    }
    const invoiceIds = [...new Set(reconciliations.map((row) => row.current_product_invoice_id).filter((id): id is string => Boolean(id)))];
    const invoices = [];
    const invoiceLines = [];
    for (const invoiceChunk of chunks(invoiceIds)) {
      const invoiceRows = await readInvoiceIdentityRows((from, to) => client.from("invoices").select("id, dispatch_id, pca_original, status")
        .eq("project_id", projectId).eq("invoice_type", "PRODUCT").in("dispatch_id", ids).in("id", invoiceChunk).order("id").range(from, to));
      const lines = invoiceRows.length ? await readInvoiceIdentityRows((from, to) => client.from("invoice_lines").select("id, invoice_id, code, description")
        .in("invoice_id", invoiceRows.map((invoice) => invoice.id)).order("id").range(from, to)) : [];
      invoices.push(...invoiceRows);
      invoiceLines.push(...lines);
    }
    for (const dispatch of candidates) {
      const guideIds = new Set(guides.filter((guide) => guide.dispatch_id === dispatch.id).map((guide) => guide.id));
      const expectedProducts = dispatchProducts(
        guideLines.filter((line) => guideIds.has(line.guide_id)),
        programmingLines.filter((line) => line.programming_id === dispatch.programming_id).map((line) => line.concrete_type),
        catalog,
      );
      const currentInvoiceId = reconciliations.find((row) => row.dispatch_id === dispatch.id)?.current_product_invoice_id;
      const productInvoice = invoices.find((invoice) => invoice.id === currentInvoiceId && invoice.dispatch_id === dispatch.id
        && !["CANCELLED", "NON_PROCEEDING", "SUPERSEDED"].includes(invoice.status));
      const productInvoiceIdentityValid = Boolean(productInvoice && matchInvoiceProducts(
        invoiceLines.filter((line) => line.invoice_id === productInvoice.id).map((line) => ({ code: line.code ?? "", description: line.description ?? "" })),
        expectedProducts,
      ) === "MATCH");
      identities.set(dispatch.id, { expectedProducts, productInvoicePca: productInvoice?.pca_original ?? null, productInvoiceIdentityValid });
    }
  }
  return identities;
}
