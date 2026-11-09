import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as radar from "../src/features/reports/radar.ts";
import { guideReportMetadata } from "../src/features/reports/guide-metadata.ts";
import { buildRadarWorkbook } from "../src/features/reports/radar-workbook.ts";

const source = await readFile(new URL("../src/features/reports/radar-queries.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const filters = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };
const projects = [{ id: "project-a", name: "ACOAT", code: "ACOAT", timezone: "America/Guatemala" }];

function fixture({ guideCount = 2, errorTable } = {}) {
  const calls = [];
  const tables = {
    programming: [{ id: "program-a", project_id: "project-a", scheduled_at: "2026-12-01T05:00:00Z", casting_element: "PILES", unit_code: "M3" }, { id: "program-b", project_id: "project-b", scheduled_at: "2026-11-03T13:00:00Z" }],
    dispatches: [{ id: "empty", project_id: "project-a", programming_id: "program-a", supplier_id: "supplier", status: "IN_EXECUTION", real_volume: 0 }, { id: "full", project_id: "project-a", programming_id: "program-a", supplier_id: "supplier", status: "COMPLETED", completed_by: "validator", real_volume: 7, real_unit_code: "M3" }, { id: "foreign", project_id: "project-b", programming_id: "program-b" }],
    dispatch_guides: Array.from({ length: guideCount }, (_, i) => ({ id: `guide-${String(i).padStart(6, "0")}`, project_id: "project-a", dispatch_id: "full", guide_number: `000${i}`, guide_date: "2026-10-15", details: { truck: i % 2 ? "189" : "183" }, laboratory_applied: i === 0 })),
    dispatch_guide_lines: Array.from({ length: guideCount }, (_, i) => ({ id: `line-${i}`, project_id: "project-a", guide_id: `guide-${String(i).padStart(6, "0")}`, position: 1, catalog_type: "PRODUCT", catalog_reference: "CONF5001", quantity: 4, unit_code: "M3" })),
    dispatch_incidents: [{ id: "incident", project_id: "project-a", dispatch_id: "full" }],
    batch_dispatches: [{ project_id: "project-a", dispatch_id: "full", batch_id: "batch", removed_at: null }],
    batches: [{ id: "batch", project_id: "project-a", code: "LOT-1" }],
    suppliers: [{ id: "supplier", name: "Mixto Listo" }],
    dispatch_reconciliations: [{ dispatch_id: "full", project_id: "project-a", status: "RECONCILED", current_product_invoice_id: "invoice" }],
    dispatch_reconciliation_attempts: [{ id: "new", dispatch_id: "full", project_id: "project-a", difference: 0, executed_at: "2026-11-02" }, { id: "old", dispatch_id: "full", project_id: "project-a", difference: 10, executed_at: "2026-11-01" }],
    invoices: [{ id: "invoice", project_id: "project-a", invoice_number: "FACT-1", total: 100, currency: "GTQ" }],
    invoice_extractions: [{ id: "extraction", invoice_id: "invoice", verification_status: "CONFIRMED", created_at: "2026-11-02" }, { id: "other", invoice_id: "foreign", verification_status: "BAD", created_at: "2026-11-02" }],
  };
  function client(privileged = false) {
    return {
      from(table) {
        const checks = [], orders = [];
        let bounds;
        const call = { table, privileged };
        const q = {
          select(value) { call.select = value; return q; },
          in(key, values) { (call.in ??= []).push([key, values]); checks.push((row) => values.includes(row[key])); return q; },
          gte(key, value) { checks.push((row) => row[key] >= value); return q; },
          lte(key, value) { checks.push((row) => row[key] <= value); return q; },
          is(key, value) { checks.push((row) => row[key] === value); return q; },
          order(key, options) { orders.push([key, options?.ascending !== false]); return q; },
          range(from, to) { bounds = [from, to]; call.range = bounds; return q; },
          then(resolve, reject) {
            calls.push(call);
            let rows = (tables[table] ?? []).filter((row) => checks.every((check) => check(row)));
            rows.sort((a, b) => { for (const [key, ascending] of orders) { const result = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (result) return ascending ? result : -result; } return 0; });
            if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
            return Promise.resolve({ data: table === errorTable ? null : rows, error: table === errorTable ? { message: "Unavailable" } : null }).then(resolve, reject);
          },
        };
        return q;
      },
      async rpc(name, args) { calls.push({ rpc: name, args }); return { data: [{ profile_id: "validator", display_label: "Residente QA" }], error: null }; },
    };
  }
  const exports = {};
  const imports = { "server-only": {}, "@/lib/supabase/server": { createClient: async () => client() }, "@/lib/supabase/admin": { createAdminClient: () => client(true) }, "./guide-metadata": { guideReportMetadata }, "./radar": radar };
  runInNewContext(compiled, { exports, Date, Intl, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, run: (input = filters) => exports.getCastingRadar(projects, input) };
}

test("consulta por despachos, conserva los vacíos y carga sus resúmenes y guías fuera de fecha", async () => {
  const f = fixture(), data = await f.run();
  assert.deepEqual(Array.from(data.dispatches, ({ id }) => id), ["empty", "full"]);
  const full = data.dispatches[1];
  assert.equal(full.guides.length, 2);
  assert.equal(full.summary.receivedQuantity, 7);
  assert.equal(full.summary.batchCode, "LOT-1");
  assert.equal(full.summary.incidentCount, 1);
  assert.equal(full.summary.completedByName, "Residente QA");
  assert.equal(full.summary.difference, 0);
  assert.equal(full.summary.productInvoice.number, "FACT-1");
  assert.equal(full.summary.productInvoice.extractionStatus, "CONFIRMED");
  assert.deepEqual(Array.from(full.summary.castingElements), ["PILES"]);
  const selected = radar.selectRadarDispatches(data.dispatches, ["full", "empty"]);
  const workbook = buildRadarWorkbook(selected);
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.worksheets[0].getCell("A8").value, "0000");
  assert.equal(workbook.worksheets[1].getCell("A8").value, "Sin guías registradas");
  assert.ok(f.calls.filter((call) => call.privileged).every((call) => call.in.some(([key, values]) => key === "invoice_id" && values.length === 1 && values[0] === "invoice")));
});

test("la paginación conserva más de mil guías y todas las líneas", async () => {
  const f = fixture({ guideCount: 1101 });
  const data = await f.run({ ...filters, guide: "0001100", castingElement: "PILES" });
  assert.equal(data.dispatches.length, 1);
  assert.equal(data.dispatches[0].guides.length, 1101);
  assert.equal(data.dispatches[0].summary.guideCount, 1101);
  assert.ok(data.dispatches[0].guides.every((guide) => guide.concreteQuantity === 4));
  assert.ok(f.calls.some((call) => call.table === "dispatch_guides" && call.range[0] === 1000));
});

test("un proyecto ajeno no consulta datos y los errores no se presentan como una lista vacía", async () => {
  const f = fixture();
  assert.equal((await f.run({ ...filters, projectId: "project-b" })).dispatches.length, 0);
  assert.equal(f.calls.length, 0);
  await assert.rejects(fixture({ errorTable: "dispatches" }).run(), /No fue posible cargar/);
});
