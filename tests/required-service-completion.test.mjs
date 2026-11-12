import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

async function load(path, imports) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl, performance, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}

test("el mapa de cierre usa una sola consulta y no acepta errores o datos ambiguos como conciliados", async () => {
  for (const result of [{ data: null, error: { message: "missing RPC" } }, { data: { dispatch: "RECONCILED" }, error: null }, { data: [], error: null }]) {
    const loaded = await load("src/features/dispatches/billing-completion-queries.ts", { "server-only": {}, "@/lib/supabase/server": { createClient: async () => ({ rpc: async () => result }) } });
    await assert.rejects(loaded.getDispatchBillingCompletion(["project"]), /No fue posible verificar/);
  }
  const calls = [];
  const loaded = await load("src/features/dispatches/billing-completion-queries.ts", { "server-only": {}, "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { direct: true, pendingService: false }, error: null }; } }) } });
  assert.equal(JSON.stringify(await loaded.getDispatchBillingCompletion([])), "{}");
  assert.equal(calls.length, 0);
  const states = await loaded.getDispatchBillingCompletion(["project", "project"]);
  assert.equal(states.direct, true); assert.equal(states.pendingService, false);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "get_dispatch_billing_completion");
  assert.equal(JSON.stringify(calls[0].args), JSON.stringify({ p_project_ids: ["project"] }));
});

test("los contadores del lote usan cierre financiero completo y no confunden Producto conciliado con Servicio pendiente", async () => {
  const reads = [], completionCalls = [];
  const tables = {
    batches: [{ id: "batch", project_id: "project", code: "QA", period_start: "2026-11-09", period_end: "2026-11-15", accounting_period: "2026-11-01", status: "OPEN", creation_source: "USER" }],
    batch_dispatches: [
      { id: "r1", project_id: "project", batch_id: "batch", dispatch_id: "direct", removed_at: null },
      { id: "r2", project_id: "project", batch_id: "batch", dispatch_id: "pendingService", removed_at: null },
      { id: "r3", project_id: "project", batch_id: "batch", dispatch_id: "unknown", removed_at: null },
      { id: "r4", project_id: "project", batch_id: "batch", dispatch_id: "old", removed_at: "2026-11-10", rolled_to_batch_id: "next" },
    ],
  };
  const client = { from(name) {
    reads.push(name); assert.ok(Object.hasOwn(tables, name), name);
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; }, then(resolve) { return Promise.resolve({ data: tables[name], error: null }).then(resolve); } };
    return query;
  } };
  const loaded = await load("src/features/batches/queries.ts", {
    "server-only": {}, "@/lib/supabase/server": { createClient: async () => client }, "@/lib/supabase/admin": {},
    "@/features/dispatches/billing-completion-queries": { getDispatchBillingCompletion: async (ids) => { completionCalls.push(ids); return { direct: true, pendingService: false, old: true }; } },
    "@/features/invoices/service-reconciliation": {}, "@/features/programming/invoice-policy": {}, "./formatters": {},
    "./overdue-queries": { getOverdueBatchAlerts: async () => ({ batches: [], total: 0 }) },
    "./period-policy": { projectCalendarDate: () => "2026-11-12", isBatchWeekOverdue: () => false },
    "@/features/projects/access-policy": {}, "@/features/projects/queries": {},
  });
  const result = await loaded.getBatchPageData("project", "America/Guatemala");
  assert.equal(result.history[0].activeDispatchCount, 3);
  assert.equal(result.history[0].reconciledCount, 1);
  assert.equal(result.history[0].pendingCount, 2);
  assert.equal(result.history[0].rolloverCount, 1);
  assert.deepEqual(reads, ["batches", "batch_dispatches"]);
  assert.equal(completionCalls.length, 1);
});

test("un despacho operativo finalizado conserva la advertencia hasta completar las conciliaciones", async () => {
  const jsx = (type, props) => ({ type, props });
  const loaded = await load("src/features/dispatches/components/dispatch-badges.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "@/components/ui/badge": { StatusBadge: "StatusBadge" },
    "../formatters": { formatDispatchStatus: (value) => value === "COMPLETED" ? "Completado" : "En ejecución", formatDispatchResult: (value) => value },
  });
  assert.equal(loaded.DispatchStatusBadge({ status: "COMPLETED", billingComplete: false }).props.label, "Pendiente de conciliación");
  assert.equal(loaded.DispatchStatusBadge({ status: "COMPLETED", billingComplete: false }).props.tone, "warning");
  assert.equal(loaded.DispatchStatusBadge({ status: "COMPLETED", billingComplete: true }).props.label, "Completado");
  assert.equal(loaded.DispatchStatusBadge({ status: "IN_EXECUTION", billingComplete: false }).props.label, "En ejecución");
});
