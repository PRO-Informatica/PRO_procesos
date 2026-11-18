import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { dashboardBillingStatus } from "../src/features/dashboard/reconciliation.ts";
import { serviceReconciliationSummary } from "../src/features/invoices/service-reconciliation.ts";
import { requiresServiceInvoice } from "../src/features/programming/invoice-policy.ts";
import { resolveReconciliationQuantityBasis, selectValidProgrammedQuantity } from "../src/features/invoices/reconciliation-quantity.ts";
import { selectDashboardRecords } from "../src/features/dashboard/details.ts";

const reconciled = { dispatch_id: "d", status: "RECONCILED", service_status: "RECONCILED", current_product_invoice_id: "product", current_service_invoice_id: "service" };

test("conciliación completa requiere ambas facturas y la validación autoritativa", () => {
  assert.equal(dashboardBillingStatus(reconciled, ["PUMP"], true), "reconciled");
  assert.equal(dashboardBillingStatus(reconciled, ["PUMP"], false), "pendingReconciliation");
  assert.equal(dashboardBillingStatus({ ...reconciled, service_status: "PENDING_RECONCILIATION" }, ["PUMP"], true), "pendingReconciliation");
  assert.equal(dashboardBillingStatus({ ...reconciled, status: "PENDING_RECONCILIATION" }, ["PUMP"], true), "pendingReconciliation");
  for (const field of ["current_product_invoice_id", "current_service_invoice_id"]) {
    assert.equal(dashboardBillingStatus({ ...reconciled, [field]: null }, ["PUMP"], true), "pendingInvoices");
  }
  assert.equal(dashboardBillingStatus(undefined, ["PUMP"], false), "pendingInvoices");
});

test("las diferencias y refacturaciones de cualquiera de las dos facturas ocupan un solo grupo", () => {
  for (const status of ["WITH_DIFFERENCES", "PENDING_REINVOICING"]) {
    for (const field of ["status", "service_status"]) {
      assert.equal(dashboardBillingStatus({ ...reconciled, [field]: status }, ["PUMP"], true), "reinvoicing");
    }
    assert.equal(dashboardBillingStatus({ ...reconciled, status, service_status: status }, ["PUMP"], false), "reinvoicing");
    assert.equal(dashboardBillingStatus({ ...reconciled, current_product_invoice_id: null, service_status: status }, ["PUMP"], false), "reinvoicing");
  }
});

test("solo Concreto directo explícito conserva la excepción de Servicio", () => {
  const direct = { ...reconciled, current_service_invoice_id: null, service_status: "NOT_STARTED" };
  assert.equal(dashboardBillingStatus(direct, ["DIRECT"], true), "reconciled");
  for (const modes of [null, undefined, [], ["PUMP"], ["DIRECT", "PUMP"]]) {
    assert.equal(dashboardBillingStatus(direct, modes, true), "pendingInvoices");
  }
  assert.equal(dashboardBillingStatus({ ...reconciled, service_status: "PENDING_REINVOICING" }, ["DIRECT"], true), "reinvoicing");
});

const source = await readFile(new URL("../src/features/dashboard/queries.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const reconciliationCompiled = ts.transpileModule(await readFile(new URL("../src/features/reconciliation/queries.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const agingCompiled = ts.transpileModule(await readFile(new URL("../src/features/dashboard/reinvoicing-aging-queries.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ count = 4, complete = false, direct = false, errorTable, rpcError = false, duplicate = false } = {}) {
  const calls = [];
  const dispatches = Array.from({ length: count }, (_, i) => ({ id: `dispatch-${String(i).padStart(5, "0")}`, project_id: "project-a", programming_id: "program" }));
  const tables = {
    programming: [{ id: "program", project_id: "project-a", delivery_modes: direct ? ["DIRECT"] : ["PUMP"], scheduled_at: "2026-11-10T13:00:00Z", unit_code: "M3", status: "DISPATCH_COMPLETED", requested_quantity: 7 }],
    dispatches: [...dispatches, { id: "without-reconciliation", project_id: "project-a", programming_id: "program" }, { id: "foreign", project_id: "project-b", programming_id: "foreign" }],
    dispatch_reconciliations: [
      ...dispatches.map((row, i) => ({ ...reconciled, dispatch_id: row.id, project_id: "project-a", service_status: direct ? "NOT_STARTED" : complete ? "RECONCILED" : i === 0 ? "WITH_DIFFERENCES" : "PENDING_REINVOICING", current_service_invoice_id: direct ? null : "service" })),
      { ...reconciled, dispatch_id: "foreign", project_id: "project-b" },
    ],
    batches: [{ id: "batch", code: "LOT-2026-11-09", project_id: "project-a", period_start: "2026-11-09", period_end: "2026-11-15", status: "CLOSED", members: [
      ...dispatches.map((row, i) => ({ dispatch_id: row.id, removed_at: duplicate && i === 0 ? "2026-11-15" : null })),
      { dispatch_id: "without-reconciliation", removed_at: null },
      { dispatch_id: "foreign", removed_at: null },
      ...(duplicate ? [{ dispatch_id: dispatches[1].id, removed_at: null }] : []),
    ] }],
  };
  const client = { from(table) {
    const call = { table, eq: [], in: [] }, checks = [], orders = [];
    let bounds, limit, single = false;
    const query = {
      select(value) { call.select = value; return query; },
      is(key, value) { checks.push(row => row[key] === value); return query; },
      eq(key, value) { call.eq.push([key, value]); checks.push(row => row[key] === value); return query; },
      in(key, values) { call.in.push([key, [...values]]); checks.push(row => values.includes(row[key])); return query; },
      or(filters) {
        const comparisons = filters.split(",").map((filter) => filter.split(".eq."));
        checks.push(row => comparisons.some(([key, value]) => row[key] === value));
        return query;
      },
      gte(key, value) { checks.push(row => row[key] >= value); return query; },
      lte(key, value) { checks.push(row => row[key] <= value); return query; },
      lt(key, value) { checks.push(row => row[key] < value); return query; },
      order(key, options) { orders.push([key, options?.ascending !== false]); return query; },
      limit(value) { limit = value; return query; },
      range(from, to) { call.range = bounds = [from, to]; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) {
        calls.push(call);
        let rows = (tables[table] ?? []).filter(row => checks.every(check => check(row)));
        rows.sort((a, b) => { for (const [key, ascending] of orders) { const result = String(a[key]).localeCompare(String(b[key])); if (result) return ascending ? result : -result; } return 0; });
        if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
        if (limit) rows = rows.slice(0, limit);
        return Promise.resolve({ data: table === errorTable ? null : single ? rows[0] ?? null : rows, error: table === errorTable ? { message: "Unavailable" } : null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const exports = {};
  const imports = {
    "server-only": {}, "@/lib/supabase/server": { createClient: async () => client }, "@/lib/supabase/admin": { createAdminClient: () => client },
    "./reconciliation": { dashboardBillingStatus },
    "@/features/dashboard/reconciliation": { dashboardBillingStatus },
    "@/features/invoices/service-reconciliation": { serviceReconciliationSummary },
    "@/features/batches/formatters": { formatProgrammingCode: id => `PRG-${id}` },
    "@/features/invoices/reconciliation-quantity": { resolveReconciliationQuantityBasis, selectValidProgrammedQuantity },
    "@/features/programming/invoice-policy": { requiresServiceInvoice },
    "@/features/dispatches/billing-completion-queries": { getDispatchBillingCompletion: async ids => {
      calls.push({ rpc: ids });
      if (rpcError) throw new Error("Completion unavailable");
      return Object.fromEntries(dispatches.map(row => [row.id, complete || direct]));
    } },
  };
  class DashboardDate extends Date {
    constructor(value) { super(value ?? "2026-11-17T16:00:00Z"); }
    static now() { return Date.parse("2026-11-17T16:00:00Z"); }
  }
  runInNewContext(compiled, { exports, Date: DashboardDate, Intl, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const listExports = {};
  runInNewContext(reconciliationCompiled, { exports: listExports, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const agingExports = {};
  runInNewContext(agingCompiled, { exports: agingExports, Date: DashboardDate, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, tables, run: () => exports.getProjectDashboard("project-a", "America/Guatemala"), list: () => listExports.getGlobalReconciliation("project-a"), aging: () => agingExports.getReinvoicingAging("project-a") };
}

test("la antigüedad usa la solicitud de la factura vigente y excluye diferencias, otros proyectos y fechas sin evidencia", async () => {
  const f = fixture();
  const [, both, missing, recipient] = f.tables.dispatch_reconciliations;
  both.id = "recon-both";
  both.status = "PENDING_REINVOICING";
  both.current_service_invoice_id = "service-current";
  missing.id = "recon-missing";
  missing.current_service_invoice_id = "service-missing";
  recipient.id = "recon-recipient";
  recipient.current_service_invoice_id = "service-recipient";
  f.tables.dispatch_reconciliations.at(-1).status = "PENDING_REINVOICING";
  f.tables.invoices = ["product", "service-current", "service-missing", "service-recipient"].map(id => ({ id, project_id: "project-a", created_at: "2026-11-03T00:00:00Z" }));
  f.tables.invoice_recipient_exceptions = [{ invoice_id: "service-recipient", project_id: "project-a", status: "REINVOICE_REQUESTED", decided_at: "2026-11-08T00:00:00Z" }];
  f.tables.audit_events = [
    ["DISPATCH_REINVOICING_REQUESTED", null, "2026-11-05", "project-a"],
    ["DISPATCH_REINVOICING_REQUESTED", null, "2026-10-28", "project-a"],
    ["DISPATCH_SERVICE_REINVOICING_REQUESTED", "service-old", "2026-11-14", "project-a"],
    ["DISPATCH_SERVICE_REINVOICING_REQUESTED", "service-current", "2026-11-06", "project-a"],
    ["DISPATCH_SERVICE_REINVOICING_REQUESTED", "service-current", "2026-11-10", "project-b"],
  ].map(([action, invoice_id, date, project_id], index) => ({ id: String(index), action, invoice_id, created_at: `${date}T00:00:00Z`, project_id, entity_type: "dispatch_reconciliation", entity_id: both.id }));

  const { cases } = await f.aging();
  assert.deepEqual(Array.from(cases, ({ id, startedAt }) => [id, startedAt]), [
    [both.dispatch_id, Date.parse("2026-11-05")], [recipient.dispatch_id, Date.parse("2026-11-08")], [missing.dispatch_id, null],
  ]);
  assert.deepEqual(Array.from(cases[0].requests, ({ kind, startedAt }) => [kind, startedAt]), [["Producto", Date.parse("2026-11-05")], ["Servicio", Date.parse("2026-11-06")]]);
  const audit = f.calls.find(({ table }) => table === "audit_events");
  assert.ok(audit.eq.some(([field, value]) => field === "project_id" && value === "project-a"));
  assert.deepEqual(audit.in.find(([field]) => field === "entity_id")[1], [both.id, missing.id, recipient.id]);
  assert.doesNotMatch(audit.select, /reason/u);
});

test("regresión del lote: cuatro productos conciliados con Servicio pendiente no son cuatro conciliados", async () => {
  const f = fixture(), dashboard = await f.run(), batch = dashboard.batchReconciliation[0];
  assert.deepEqual([batch.pendingInvoices, batch.pendingReconciliation, batch.reinvoicing, batch.reconciled], [1, 0, 4, 0]);
  assert.deepEqual([dashboard.metrics.orders.pending, dashboard.metrics.orders.reinvoicing, dashboard.metrics.orders.completed], [1, 4, 0]);
  assert.deepEqual([dashboard.metrics.reconciliation.matched, dashboard.metrics.reconciliation.differences, dashboard.metrics.reconciliation.withoutInvoice], [0, 4, 1]);
  assert.equal(dashboard.metrics.attention.reinvoicing, 4);
  assert.ok(f.calls.filter(call => call.eq).every(call => call.eq.some(([key, value]) => key === "project_id" && value === "project-a")));
  assert.deepEqual(Array.from(f.calls.find(call => call.rpc).rpc), ["project-a"]);
});

test("el lote excluye relaciones removidas, evita duplicados y respeta la excepción DIRECT", async () => {
  for (const options of [{ complete: true }, { direct: true }]) {
    const dashboard = await fixture({ ...options, duplicate: true }).run(), batch = dashboard.batchReconciliation[0];
    assert.equal(batch.reconciled, 3);
    assert.equal(batch.pendingInvoices, 1);
    assert.equal(dashboard.metrics.orders.completed, 4);
  }
});

test("el dashboard carga más de mil despachos sin truncar la conciliación", async () => {
  const f = fixture({ count: 1101, complete: true }), dashboard = await f.run();
  assert.equal(dashboard.metrics.orders.completed, 1101);
  assert.equal(dashboard.batchReconciliation[0].reconciled, 1101);
  assert.equal(selectDashboardRecords(dashboard, "reconciled", { batch: "batch" }).length, 1101);
  for (const table of ["dispatches", "dispatch_reconciliations"]) {
    assert.equal(f.calls.filter(call => call.table === table && call.range).length, 3);
  }
});

test("abrir seis refacturaciones devuelve esos seis despachos y respeta el lote seleccionado", async () => {
  const f = fixture({ count: 6, duplicate: true });
  // One issue is on Product; the others are on Service. Neither is lost.
  f.tables.dispatch_reconciliations[0].status = "PENDING_REINVOICING";
  f.tables.dispatch_reconciliations[0].service_status = "RECONCILED";
  f.tables.batches.push({ id: "another-batch", code: "LOT-2026-11-16", project_id: "project-a", period_start: "2026-11-16", period_end: "2026-11-22", status: "OPEN", members: [{ dispatch_id: "dispatch-00000", removed_at: null }] });
  const dashboard = await f.run();
  const all = selectDashboardRecords(dashboard, "reinvoicing");
  assert.equal(all.length, dashboard.metrics.attention.reinvoicing);
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map(row => row.id)).size, 6);
  assert.ok(all.some(row => row.productStatus === "PENDING_REINVOICING"));
  assert.ok(all.some(row => row.serviceStatus === "PENDING_REINVOICING"));
  for (const batch of dashboard.batchReconciliation) {
    for (const view of ["pendingInvoices", "pendingReconciliation", "reinvoicing", "reconciled"]) {
      assert.equal(selectDashboardRecords(dashboard, view, { batch: batch.batchId }).length, batch[view]);
    }
  }
  assert.equal(selectDashboardRecords(dashboard, "reinvoicing", { batch: "batch" }).length, 5);
  assert.deepEqual(selectDashboardRecords(dashboard, "reinvoicing", { batch: "another-batch" }).map(row => row.id), ["dispatch-00000"]);
  assert.equal(selectDashboardRecords(dashboard, "reconciled").length, 0);
  assert.ok(dashboard.records.every(row => !row.href.includes("foreign")));
  assert.equal(selectDashboardRecords(dashboard, "orders", { batch: "foreign-batch" }).length, 0);
});

test("los enlaces diarios, semanales y mensuales coinciden con las cantidades del indicador", async () => {
  const f = fixture();
  const program = f.tables.programming[0];
  f.tables.programming = [
    { ...program, id: "today", scheduled_at: "2026-11-17T13:00:00Z", status: "COMPLETED", confirmed_quantity: 8 },
    { ...program, id: "night", scheduled_at: "2026-11-18T02:00:00Z", requested_quantity: 2 },
    { ...program, id: "week", scheduled_at: "2026-11-19T13:00:00Z", requested_quantity: 4 },
    { ...program, id: "overdue", scheduled_at: "2026-11-10T13:00:00Z" },
    { ...program, id: "cancelled", scheduled_at: "2026-11-17T13:00:00Z", status: "CANCELLED" },
    { ...program, id: "service", scheduled_at: "2026-11-17T13:00:00Z", unit_code: "UN", requested_quantity: 1 },
  ];
  f.tables.dispatch_guides = [
    { id: "guide-today", project_id: "project-a", dispatch_id: "dispatch-00000", guide_date: "2026-11-17", guide_number: "A-1", quantity: 5, unit_code: "M3" },
    { id: "guide-month", project_id: "project-a", dispatch_id: "dispatch-00000", guide_date: "2026-11-10", quantity: 3, unit_code: "M3" },
    { id: "guide-service", project_id: "project-a", dispatch_id: "dispatch-00000", guide_date: "2026-11-17", quantity: 2, unit_code: "UN" },
    { id: "guide-foreign", project_id: "project-b", dispatch_id: "foreign", guide_date: "2026-11-17", quantity: 100, unit_code: "M3" },
  ];
  const dashboard = await f.run();
  for (const view of ["today", "week"]) assert.equal(selectDashboardRecords(dashboard, view).length, dashboard.metrics[view].total);
  assert.equal(selectDashboardRecords(dashboard, "weekCompleted").length, dashboard.metrics.week.completed);
  assert.equal(selectDashboardRecords(dashboard, "weekPending").length, dashboard.metrics.week.pending);
  const volume = view => selectDashboardRecords(dashboard, view).reduce((sum, row) => sum + row.quantity, 0);
  assert.equal(volume("month"), dashboard.metrics.month.programmedM3);
  assert.equal(volume("receivedMonth"), dashboard.metrics.month.receivedM3);
  for (const day of dashboard.weekDays) {
    for (const [view, field] of [["programmedDay", "programmedM3"], ["receivedDay", "receivedM3"]]) {
      assert.equal(selectDashboardRecords(dashboard, view, { date: day.date }).reduce((sum, row) => sum + row.quantity, 0), day[field]);
    }
  }
  assert.equal(selectDashboardRecords(dashboard, "programmedDay", { date: "2026-11-17" }).length, 2);
  assert.equal(selectDashboardRecords(dashboard, "receivedDay", { date: "2026-11-17" }).length, 1);
  assert.equal(selectDashboardRecords(dashboard, "programmedDay", { date: "2026-10-01" }).length, 0);
  assert.equal(selectDashboardRecords(dashboard, "overdue").length, dashboard.metrics.attention.overdueProgramming);
});

test("un error de conciliación impide presentar cifras incompletas", async () => {
  for (const errorTable of ["dispatches", "dispatch_reconciliations", "programming"]) {
    await assert.rejects(fixture({ errorTable }).run(), /No fue posible cargar/);
  }
  await assert.rejects(fixture({ rpcError: true }).run(), /Completion unavailable/);
});


test("la lista reutilizada coincide con las seis refacturaciones e incluye despachos sin factura o lote", async () => {
  const f = fixture({ count: 6 });
  f.tables.dispatch_reconciliations[0].status = "PENDING_REINVOICING";
  f.tables.dispatch_reconciliations[0].service_status = "RECONCILED";
  f.tables.batch_dispatches = f.tables.batches[0].members.map((row, i) => ({ ...row, id: String(i), batch_id: "batch", project_id: "project-a" }));
  // Remove a relation: the dispatch still belongs in the global indicator.
  f.tables.batch_dispatches[1].removed_at = "2026-11-16";
  f.tables.batch_dispatches.push({ ...f.tables.batch_dispatches[0], id: "duplicate" });
  const dashboard = await f.run(), list = await f.list();
  assert.equal(list.items.length, 7);
  assert.equal(new Set(list.items.map(row => row.dispatchId)).size, 7);
  for (const bucket of ["pendingInvoices", "pendingReconciliation", "reinvoicing", "reconciled"]) {
    assert.deepEqual(Array.from(list.items.filter(row => row.billingStatus === bucket), row => row.dispatchId).sort(), Array.from(selectDashboardRecords(dashboard, bucket), row => row.id).sort());
  }
  const without = list.items.find(row => row.dispatchId === "without-reconciliation");
  assert.equal(without.billingStatus, "pendingInvoices");
  assert.equal(without.reconciliationStatus, "NOT_STARTED");
  assert.equal(list.items.find(row => row.dispatchId === "dispatch-00001").batchId, "");
  assert.ok(list.items.every(row => !row.dispatchId.includes("foreign")));
});

test("Conciliación comparte la excepción DIRECT y carga más de mil filas sin truncar", async () => {
  const f = fixture({ count: 1101, direct: true });
  const data = await f.list();
  assert.equal(data.items.filter(item => item.billingStatus === "reconciled").length, 1101);
  assert.ok(data.items.every(item => item.requiresServiceInvoice === false));
  for (const table of ["dispatches", "dispatch_reconciliations"]) assert.equal(f.calls.filter(call => call.table === table).length, 3);
});
