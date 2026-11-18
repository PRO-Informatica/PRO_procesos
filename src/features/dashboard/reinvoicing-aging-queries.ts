import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { ReinvoicingAging, ReinvoicingCase, ReinvoicingRequest } from "./reinvoicing-aging";

const PENDING = "PENDING_REINVOICING";
const PRODUCT_REQUEST = "DISPATCH_REINVOICING_REQUESTED";
const SERVICE_REQUEST = "DISPATCH_SERVICE_REINVOICING_REQUESTED";

type InvoiceRequest = { kind: ReinvoicingRequest["kind"]; invoiceId: string | null };
type RequestEvent = { entity_id: string; action: string; invoice_id: string | null; created_at: string };

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error(`No fue posible cargar la antigüedad de refacturación. ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function readBatches<T>(ids: string[], read: (ids: string[]) => Promise<T[]>) {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 80) rows.push(...await read(ids.slice(i, i + 80)));
  return rows;
}

export async function getReinvoicingAging(projectId: string): Promise<ReinvoicingAging> {
  const supabase = await createClient();
  const pending = await allRows((from, to) => supabase.from("dispatch_reconciliations")
    .select("id, dispatch_id, status, service_status, current_product_invoice_id, current_service_invoice_id")
    .eq("project_id", projectId).or(`status.eq.${PENDING},service_status.eq.${PENDING}`).order("id").range(from, to));
  const asOf = Date.now();
  if (!pending.length) return { asOf, cases: [] };

  const dispatches = await readBatches(pending.map((row) => row.dispatch_id), (ids) => allRows((from, to) => supabase.from("dispatches")
    .select("id, programming_id, order_number").eq("project_id", projectId).in("id", ids).order("id").range(from, to)));
  const dispatchById = new Map(dispatches.map((row) => [row.id, row]));
  const authorized = pending.filter((row) => dispatchById.has(row.dispatch_id));
  if (!authorized.length) return { asOf, cases: [] };

  const invoiceIds = new Set<string>();
  const requestsByReconciliation = new Map(authorized.map((row) => {
    const requests: InvoiceRequest[] = [];
    if (row.status === PENDING) requests.push({ kind: "Producto", invoiceId: row.current_product_invoice_id });
    if (row.service_status === PENDING) requests.push({ kind: "Servicio", invoiceId: row.current_service_invoice_id });
    requests.forEach(({ invoiceId }) => { if (invoiceId) invoiceIds.add(invoiceId); });
    return [row.id, requests] as const;
  }));
  const [invoices, decisions] = await Promise.all([
    readBatches([...invoiceIds], (ids) => allRows((from, to) => supabase.from("invoices")
      .select("id, created_at").eq("project_id", projectId).in("id", ids).order("id").range(from, to))),
    readBatches([...invoiceIds], (ids) => allRows((from, to) => supabase.from("invoice_recipient_exceptions")
      .select("invoice_id, decided_at").eq("project_id", projectId).eq("status", "REINVOICE_REQUESTED")
      .in("invoice_id", ids).order("invoice_id").range(from, to))),
  ]);

  // Purchasing can read these invoices, but need not have general audit access.
  // Resolve only request timestamps for current invoices visible to the actor.
  const createdByInvoice = new Map(invoices.map((row) => [row.id, Date.parse(row.created_at)]));
  const decisionsByInvoice = new Map(decisions.map((row) => [row.invoice_id, row.decided_at]));
  const eventIds = authorized.filter((row) => requestsByReconciliation.get(row.id)?.some(({ invoiceId }) =>
    invoiceId !== null && createdByInvoice.has(invoiceId))).map((row) => row.id);
  const eventsByReconciliation = new Map<string, RequestEvent[]>();
  if (eventIds.length) {
    const admin = createAdminClient();
    const events = await readBatches(eventIds, (ids) => allRows<RequestEvent>((from, to) => admin.from("audit_events")
      .select("entity_id, action, invoice_id:new_values->>invoice_id, created_at")
      .eq("project_id", projectId).eq("entity_type", "dispatch_reconciliation")
      .in("entity_id", ids).in("action", [PRODUCT_REQUEST, SERVICE_REQUEST]).order("id").range(from, to)));
    for (const event of events) {
      const group = eventsByReconciliation.get(event.entity_id) ?? [];
      group.push(event);
      eventsByReconciliation.set(event.entity_id, group);
    }
  }

  const cases = authorized.map((row): ReinvoicingCase => {
    const dispatch = dispatchById.get(row.dispatch_id)!;
    const events = eventsByReconciliation.get(row.id) ?? [];
    const requests = requestsByReconciliation.get(row.id)!.map(({ kind, invoiceId }): ReinvoicingRequest => {
      if (!invoiceId || !createdByInvoice.has(invoiceId)) return { kind, startedAt: null };
      const createdAt = createdByInvoice.get(invoiceId)!;
      const action = kind === "Producto" ? PRODUCT_REQUEST : SERVICE_REQUEST;
      const timestamps = events.filter((event) => event.action === action && (
        event.invoice_id === invoiceId || (kind === "Producto" && !event.invoice_id)
      )).map((event) => Date.parse(event.created_at));
      const decidedAt = decisionsByInvoice.get(invoiceId);
      if (decidedAt) timestamps.push(Date.parse(decidedAt));
      // Legacy Product audit records lack an invoice ID. Only requests made
      // during the lifetime of the current invoice can belong to this cycle.
      const dates = timestamps.filter((time) => time >= createdAt && time <= asOf);
      return { kind, startedAt: dates.length ? Math.max(...dates) : null };
    });
    const knownDates = requests.flatMap(({ startedAt }) => startedAt === null ? [] : [startedAt]);
    return {
      id: dispatch.id, code: `DSP-${dispatch.id.slice(0, 8).toUpperCase()}`,
      programmingCode: `PRG-${dispatch.programming_id.slice(0, 8).toUpperCase()}`, orderNumber: dispatch.order_number,
      requests, startedAt: knownDates.length ? Math.min(...knownDates) : null,
    };
  }).sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || a.code.localeCompare(b.code));

  return { asOf, cases };
}
