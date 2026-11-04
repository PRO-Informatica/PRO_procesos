import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../src/features/batches/actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const project = "00000000-0000-4000-8000-000000000001", batch = "00000000-0000-4000-8000-000000000002";
const completed = "00000000-0000-4000-8000-000000000003", running = "00000000-0000-4000-8000-000000000004";
function fixture({ rows = [], permitted = true, error = null } = {}) {
  const calls = [], reads = [], exports = {};
  const client = {
    from(table) {
      const filters = []; reads.push({ table, filters });
      const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, in(key, value) { filters.push([key, value]); return query; }, then(resolve, reject) { return Promise.resolve({ data: rows, error }).then(resolve, reject); } };
      return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { data: args.p_dispatch_ids.length, error: null }; },
  };
  const imports = {
    "next/cache": { revalidatePath() {} }, "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "user" }) },
    "@/features/projects/queries": { getOperationalProjectAccessForProject: async () => ({ permissions: permitted ? ["batch.modify"] : [] }) },
    "@/lib/supabase/server": { createClient: async () => client },
  };
  for (const name of ["@/features/invoices/dispatch-invoice-identity", "./invoice-upload-pairing", "@/features/invoices/invoice-classification", "@/features/invoices/dispatch-invoice-identity-queries", "@/features/invoices/invoice-processing", "@/features/invoices/reconciliation-quantity", "@/features/invoices/reinvoicing", "@/features/invoices/recipient-exception-service", "@/lib/address-identity", "@/lib/supabase/admin", "./mixto-listo-extractor", "./period-policy", "./mixto-listo-parser"]) imports[name] = {};
  runInNewContext(code, { exports, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { action: exports.addDispatchToBatchAction, calls, reads };
}
function form(ids) { const data = new FormData(); data.set("projectId", project); data.set("batchId", batch); ids.forEach(id => data.append("dispatchIds", id)); return data; }

test("agregar al lote admite únicamente la selección completada y verifica el proyecto", async () => {
  const f = fixture({ rows: [{ id: completed, status: "COMPLETED" }] });
  assert.equal((await f.action({}, form([completed]))).status, "success");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, "add_dispatches_to_batch");
  assert.equal(f.calls[0].args.p_dispatch_ids[0], completed);
  assert.ok(f.reads[0].filters.some(([key, value]) => key === "project_id" && value === project));
});

test("una selección mixta o desactualizada se rechaza completa antes de asignar", async () => {
  for (const rows of [[{ id: completed, status: "COMPLETED" }, { id: running, status: "IN_EXECUTION" }], [{ id: completed, status: "COMPLETED" }]]) {
    const f = fixture({ rows }); const result = await f.action({}, form([completed, running]));
    assert.equal(result.status, "error"); assert.match(result.message, /completados/u); assert.equal(f.calls.length, 0);
  }
});

test("no asigna si falla la consulta ni consulta despachos si falta permiso", async () => {
  const failed = fixture({ error: { message: "unavailable" } });
  assert.equal((await failed.action({}, form([completed]))).status, "error"); assert.equal(failed.calls.length, 0);
  const denied = fixture({ permitted: false });
  assert.equal((await denied.action({}, form([completed]))).status, "error"); assert.equal(denied.reads.length, 0);
});
