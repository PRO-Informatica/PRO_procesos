import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { dashboardBillingStatus } from "../src/features/dashboard/reconciliation.ts";

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
    const call = { table, eq: [] }, checks = [], orders = [];
    let bounds, limit, single = false;
    const query = {
      select(value) { call.select = value; return query; },
      eq(key, value) { call.eq.push([key, value]); checks.push(row => row[key] === value); return query; },
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
    "server-only": {}, "@/lib/supabase/server": { createClient: async () => client },
    "./reconciliation": { dashboardBillingStatus },
    "@/features/dispatches/billing-completion-queries": { getDispatchBillingCompletion: async ids => {
      calls.push({ rpc: ids });
      if (rpcError) throw new Error("Completion unavailable");
      return Object.fromEntries(dispatches.map(row => [row.id, complete || direct]));
    } },
  };
  runInNewContext(compiled, { exports, Date, Intl, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, run: () => exports.getProjectDashboard("project-a", "America/Guatemala") };
}

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
  for (const table of ["dispatches", "dispatch_reconciliations"]) {
    assert.equal(f.calls.filter(call => call.table === table && call.range).length, 3);
  }
});

test("un error de conciliación impide presentar cifras incompletas", async () => {
  for (const errorTable of ["dispatches", "dispatch_reconciliations", "programming"]) {
    await assert.rejects(fixture({ errorTable }).run(), /No fue posible cargar/);
  }
  await assert.rejects(fixture({ rpcError: true }).run(), /Completion unavailable/);
});
