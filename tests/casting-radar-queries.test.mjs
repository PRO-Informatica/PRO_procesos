import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { withQuotationSpecifications } from "../src/features/reports/quotation-specifications.ts";
import { serviceReconciliationSummary } from "../src/features/invoices/service-reconciliation.ts";
import { requiresServiceInvoice } from "../src/features/programming/invoice-policy.ts";
import * as radar from "../src/features/reports/radar.ts";
import { guideReportMetadata } from "../src/features/reports/guide-metadata.ts";
import { buildRadarWorkbook } from "../src/features/reports/radar-workbook.ts";
import { buildConcreteControlWorkbook } from "../src/features/reports/concrete-control-workbook.ts";

const source = await readFile(new URL("../src/features/reports/radar-queries.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const filters = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };
const projects = [{ id: "project-a", name: "ACOAT", code: "ACOAT", companyName: "Empresa QA", timezone: "America/Guatemala" }];

function fixture({ guideCount = 2, billingComplete = false, quotedMetadata = false, programmingConcrete = false, reportProjects = projects, errorTable } = {}) {
  const calls = [];
  const tables = {
    programming: [{ id: "program-a", project_id: "project-a", scheduled_at: "2026-12-01T05:00:00Z", casting_element: "PILES", unit_code: "M3" }, { id: "program-b", project_id: "project-b", scheduled_at: "2026-11-03T13:00:00Z" }],
    dispatches: [{ id: "empty", project_id: "project-a", programming_id: "program-a", supplier_id: "supplier", status: "IN_EXECUTION", real_volume: 0 }, { id: "full", project_id: "project-a", programming_id: "program-a", supplier_id: "supplier", status: "COMPLETED", result: "DISPATCHED", completed_by: "validator", real_volume: 7, real_unit_code: "M3" }, { id: "foreign", project_id: "project-b", programming_id: "program-b" }],
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
  if (quotedMetadata) {
    tables.dispatch_guide_lines.forEach(line => { line.product_price_id="product-a"; line.product_code="86131064"; line.unit_price=100; line.currency="GTQ"; });
    tables.project_product_prices=[{id:"product-a",project_id:"project-a",code:"86131064",reference:"CONF5001",resistance_psi:5000,slump:'5 +/-1"',price:1224.16}, {id:"foreign-product",project_id:"project-b",code:"86131064",reference:"CONF5001",resistance_psi:9000,slump:'9"'}];
  }
  if (programmingConcrete) {
    tables.programming_lines=[{id:'plan-line',programming_id:'program-a',concrete_type:'CONF5001',unit_code:'M3'}, {id:'foreign-plan-line',programming_id:'program-b',concrete_type:'CONF9001',unit_code:'M3'}];
    tables.dispatch_guide_lines.forEach(line => { line.product_price_id=null; line.product_code=''; line.catalog_reference=''; });
  }
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
  const imports = { "server-only": {}, "@/features/dispatches/billing-completion-queries": { getDispatchBillingCompletion: async (ids) => { calls.push({ billingProjects: Array.from(ids) }); return { full: billingComplete, empty: false }; } }, "@/lib/supabase/server": { createClient: async () => client() }, "@/lib/supabase/admin": { createAdminClient: () => client(true) }, "./quotation-specifications": { withQuotationSpecifications }, "./guide-metadata": { guideReportMetadata }, "./radar": radar };
  imports["@/features/invoices/service-reconciliation"] = { serviceReconciliationSummary };
  imports["@/features/programming/invoice-policy"] = { requiresServiceInvoice };
  runInNewContext(compiled, { exports, Date, Intl, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, tables, run: (input = filters) => exports.getCastingRadar(reportProjects, input) };
}

test("Radar y Control de concreto verifican conciliación solo de proyectos con despachos", async () => {
  const f = fixture({ reportProjects: [...projects, { id: "project-c", name: "Otra empresa sin despachos", timezone: "America/Guatemala" }] });
  const data = await f.run();
  assert.equal(data.dispatches.length, 2);
  assert.deepEqual(f.calls.find(call => call.billingProjects)?.billingProjects, ["project-a"]);
  const empty = fixture();
  assert.equal((await empty.run({ dateFrom: "2030-01-01", dateTo: "2030-01-31" })).dispatches.length, 0);
  assert.ok(!empty.calls.some(call => call.billingProjects));
});

test("consulta por despachos, conserva los vacíos y carga sus resúmenes y guías fuera de fecha", async () => {
  const f = fixture(), data = await f.run();
  assert.deepEqual(Array.from(data.dispatches, ({ id }) => id), ["empty", "full"]);
  const full = data.dispatches[1];
  assert.equal(full.guides.length, 2);
  assert.equal(full.summary.receivedQuantity, 7);
  assert.equal(full.summary.physicalResult, "DISPATCHED");
  assert.equal(data.dispatches[0].summary.physicalResult, "PENDING");
  assert.ok(f.calls.find(call => call.table === "dispatches")?.select.split(", ").includes("result"));
  assert.equal(full.summary.billingComplete, false);
  assert.equal(full.summary.batchCode, "LOT-1");
  assert.equal(full.summary.incidentCount, 1);
  assert.equal(full.summary.completedByName, "Residente QA");
  assert.equal(full.summary.projectName, full.projectName);
  assert.equal(full.summary.companyName, "Empresa QA");
  assert.equal(full.summary.scheduledAt, full.scheduledAt);
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

test("los resúmenes distinguen Producto conciliado, diferencias de Servicio y concreto directo", async () => {
  const { tables, run } = fixture();
  tables.programming[0].delivery_modes = ["DIRECT"];
  Object.assign(tables.dispatch_reconciliations[0], {
    current_service_invoice_id: "service",
    service_status: "WITH_DIFFERENCES",
    service_comparison: { difference: "167.74", currency: "GTQ" },
  });
  const { dispatches } = await run();
  const full = dispatches.find(({ id }) => id === "full").summary;
  assert.equal(full.reconciliationStatus, "RECONCILED");
  assert.equal(full.serviceReconciliation.status, "WITH_DIFFERENCES");
  assert.equal(full.serviceReconciliation.difference, 167.74);
  assert.equal(dispatches.find(({ id }) => id === "empty").summary.serviceReconciliation, null);
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


test("la conciliación completa filtra despachos en servidor y conserva todas las guías", async () => {
  const f = fixture({ billingComplete: true });
  const complete = await f.run({ ...filters, billingStatus: "reconciled", guide: "0000" });
  assert.deepEqual(Array.from(complete.dispatches, row => row.id), ["full"]);
  assert.equal(complete.dispatches[0].guides.length, 2);
  const pending = await f.run({ ...filters, billingStatus: "pending" });
  assert.deepEqual(Array.from(pending.dispatches, row => row.id), ["empty"]);
  assert.equal((await fixture().run({ ...filters, billingStatus: "reconciled" })).dispatches.length, 0);
});

test("reportes consultan especificaciones solo de proyectos autorizados y completan cada guía", async () => {
  const f=fixture({quotedMetadata:true});
  const data=await f.run();
  const full=data.dispatches.find(d=>d.id==="full");
  assert.ok(full.guides.every(g=>g.lines[0].resistancePsi===5000 && g.lines[0].unitPrice===100));
  assert.equal(full.guides[0].slump,'Cotización: 5 +/-1"');
  assert.equal(full.guides[1].slump,'');
  const query=f.calls.find(c=>c.table==="project_product_prices");
  assert.deepEqual(Array.from(query.in[0][1]),["project-a"]);
  await assert.rejects(fixture({errorTable:"project_product_prices"}).run(), /No fue posible cargar/);
});

test("Sistema de control consolida concreto cotizado con UM vacía usando el despacho en m³", async () => {
  const { tables, run } = fixture({ guideCount: 4, quotedMetadata: true });
  const [first, second, pumping, placement] = tables.dispatch_guide_lines;
  for (const [entry, quantity, estimatedSubtotal] of [[first, 7, 8569.12], [second, 7.5, 9181.20]]) {
    Object.assign(entry, {
      product_description: "CONF4001", catalog_reference: "CONF4001", unit_code: null,
      quantity, unit_price: 1224.16, estimated_subtotal: estimatedSubtotal,
    });
  }
  Object.assign(pumping, { catalog_type: "SERVICE", product_description: "Bomba", quantity: 14.5, unit_price: 110.32 });
  Object.assign(placement, { catalog_type: "SERVICE", product_description: "Colocación", quantity: 14.5, unit_price: 134.4 });
  Object.assign(tables.project_product_prices[0], { reference: "CONF4001", resistance_psi: 4000 });
  tables.programming_lines = [{ id: "plan", programming_id: "program-a", concrete_type: "CONF3001", unit_code: "M3" }];
  tables.dispatches.find((dispatch) => dispatch.id === "full").real_volume = 14.5;

  const { dispatches } = await run({ ...filters, dispatch: "full" });
  assert.equal(dispatches.length, 1);
  assert.deepEqual(Array.from(dispatches[0].guides, (guide) => guide.concreteQuantity), [7, 7.5, 0, 0]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildConcreteControlWorkbook(dispatches).xlsx.writeBuffer());
  const sheet = workbook.worksheets[0];
  const cell = (header) => sheet.getCell(6, sheet.getRow(5).values.indexOf(header));
  assert.equal(cell("4000 PSI (m³)").value, 14.5);
  assert.equal(cell("Costo 4000 PSI (Q/m³)").value, 1224.16);
  assert.equal(cell("Subtotal 4000 PSI (Q)").value, 17750.32);
  assert.equal(cell("Otros productos (Q)").value, 0);
  assert.equal(cell("Total concreto consumido (m³)").result, 14.5);
  assert.doesNotMatch(cell("Detalle de servicios y otros productos").value, /CONF4001/u);
  assert.equal(sheet.rowCount, 7);
  assert.equal(first.unit_code, null);
});

test("la unidad del despacho solo completa productos cotizados sin unidad explícita", () => {
  const products = [
    { catalog_type: "PRODUCT", quantity: 1, unit_code: null, resistance_psi: 4000 },
    { catalog_type: "PRODUCT", quantity: 2, unit_code: "UN", resistance_psi: 4000 },
    { catalog_type: "PRODUCT", quantity: 3, unit_code: null, resistance_psi: null },
    { catalog_type: "SERVICE", quantity: 4, unit_code: null, resistance_psi: null },
  ];
  assert.deepEqual(radar.makeRadarGuide({}, products, undefined, "M3").lines.map((line) => line.unit), ["M3", "UN", "", ""]);
  for (const unit of [undefined, "UN"]) {
    assert.deepEqual(radar.makeRadarGuide({}, products, undefined, unit).lines.map((line) => line.unit), ["", "UN", "", ""]);
  }
});

test('la programación completa el concreto de guías sin identificación, sin crear guías ni consultar programaciones ajenas', async () => {
  const f=fixture({quotedMetadata:true,programmingConcrete:true});
  const data=await f.run();
  const guide=data.dispatches.find(d=>d.id==='full').guides[0];
  assert.equal(guide.lines[0].resistancePsi,5000);
  assert.equal(guide.lines[0].quotationUnitPrice,1224.16);
  assert.equal(guide.lines[0].quotationFromProgramming,true);
  assert.equal(guide.slump,'Cotización: 5 +/-1"');
  assert.match(guide.concrete,/CONF5001/);
  assert.equal(data.dispatches.find(d=>d.id==='empty').guides.length,0);
  const query=f.calls.find(c=>c.table==='programming_lines');
  assert.deepEqual(Array.from(query.in[0][1]),['program-a']);
  assert.match(f.calls.find(c=>c.table==='project_product_prices').select,/price/);
  await assert.rejects(fixture({errorTable:'programming_lines'}).run(), /No fue posible cargar/);
});
