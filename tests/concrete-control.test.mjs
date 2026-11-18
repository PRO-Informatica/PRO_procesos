import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { buildConcreteControl, concreteStrength, controlLineCategory, controlLineSubtotal } from "../src/features/reports/concrete-control.ts";
import { buildConcreteControlWorkbook } from "../src/features/reports/concrete-control-workbook.ts";
import * as radar from "../src/features/reports/radar.ts";

const line = (description, quantity, unitPrice, changes = {}) => ({ type: "PRODUCT", code: "86131064", reference: "CONF4001", description, quantity, unit: "M3", unitPrice, estimatedSubtotal: null, currency: "GTQ", ...changes });
const service = (description, quantity, unitPrice, changes = {}) => line(description, quantity, unitPrice, { type: "SERVICE", reference: "", code: "SERV-QA", ...changes });
const guide = (id, lines, changes = {}) => ({ ...radar.makeRadarGuide({ id, guide_number: `000-${id}`, guide_date: "2026-11-03", laboratory_applied: false, details: { truck: "183" } }, [], "PILES"), lines, ...changes });
const dispatch = (id, guides) => ({ id, code: `DSP-${id}`, programmingCode: `PRG-${id}`, orderNumber: "88", projectId: "acoat", projectName: "ACOAT", supplierName: "Proveedor QA", scheduledAt: "2026-11-03T13:00:00Z", timezone: "America/Guatemala", guides, summary: { productInvoice: { number: "FACT-CONCRETO", total: 12345, currency: "GTQ" }, serviceInvoice: { number: "FACT-SERVICIO", total: 500, currency: "GTQ" } } });

const controlForGuide = (guide) => buildConcreteControl(dispatch(guide.id, [guide]));

test("PSI explícito y costos históricos, sin inventar resistencia desde códigos", () => {
  for (const value of ["4000 PSI", "4,000 PSI", "4.000 PSI", "4 000 psi"]) assert.equal(concreteStrength(line(value, 1, 100)), 4000);
  assert.equal(concreteStrength(line("Concreto fluido", 1, 100)), null);
  const row = controlForGuide(guide("a", [line("4000 PSI", 2, 100), line("4000 PSI", 3, 200), line("3500 PSI", 1, 300), line("Sin resistencia", 2, 150)]));
  assert.equal(row.concreteVolume, 8);
  assert.equal(row.concrete.value, 1400);
  assert.equal(row.strengths.get(4000).unitPrice, 160);
  assert.equal(row.strengths.get(3500).quantity, 1);
  assert.equal(row.strengths.get(null).quantity, 2);
  assert.equal(row.total.value, 1400);
  assert.ok(row.warnings.some((w) => w.includes("sin resistencia")));
});

test("bomba y colocación no duplican volumen; consumo conserva el promedio del Excel", () => {
  const row = controlForGuide(guide("a", [line("5000 PSI", 6.5, 1000), service("BOMBA + OPERADOR", 6, 80.64), service("Colocación región", 6, 93.8), service("Recargo nocturno", 1, 50, { unit: "UN" }), service("Alisado", 1, 40, { unit: "M2" }), service("Tubo adicional", 13, 12.6, { unit: "UN" })]));
  assert.equal(row.pumpingVolume, 6);
  assert.equal(row.consumedVolume, 6.25);
  assert.equal(row.pumping.value, 1046.64);
  assert.equal(row.surcharge.value, 50);
  assert.equal(row.finishing.value, 40);
  assert.equal(row.otherService.value, 163.8);
  assert.equal(row.total.value, 7800.44);
  assert.equal(controlLineCategory(line("Material", 1, 10, { unit: "UN" })), "other");
  const onlyService = controlForGuide(guide("b", [service("Colocación región", 10, 100)]));
  assert.equal(onlyService.concreteVolume, 0);
  assert.equal(onlyService.consumedVolume, 5);
  const noService = controlForGuide(guide("c", [line("4000 PSI", 10, 100)]));
  assert.equal(noService.pumpingVolume, 0);
  assert.equal(noService.consumedVolume, 5);
});

test("volumen de servicios desconocido o contradictorio queda pendiente", () => {
  const different = controlForGuide(guide("a", [service("Bombeo", 5, 10), service("Colocación", 6, 10)]));
  assert.equal(different.pumpingVolume, null);
  assert.equal(different.consumedVolume, null);
  assert.equal(different.total.value, 110);
  const missing = controlForGuide(guide("b", [service("Bomba", 1, 100, { unit: "UN" })]));
  assert.equal(missing.pumpingVolume, null);
  const paired = controlForGuide(guide("c", [service("Bomba", 1, 100, { unit: "UN" }), service("Colocación", 8, 10)]));
  assert.equal(paired.pumpingVolume, 8);
  assert.equal(controlForGuide(guide("zero", [service("Bomba", 0, null, { unit: "UN" })])).pumpingVolume, 0);
});

test("precios y monedas pendientes no se convierten en cero ni se mezclan con GTQ", () => {
  const zero = line("4000 PSI", 1, 0);
  assert.equal(controlLineSubtotal(zero), 0);
  assert.equal(controlLineSubtotal(line("4000 PSI", 1, null)), null);
  assert.equal(controlLineSubtotal(line("4000 PSI", 1, 10, { currency: "USD" })), null);
  assert.equal(controlLineSubtotal(line("4000 PSI", 1, 10, { currency: null })), null);
  assert.equal(controlLineSubtotal(line("4000 PSI", 0, null, { currency: null })), 0);
  assert.equal(controlLineSubtotal(line("4000 PSI", 1, 999, { estimatedSubtotal: 100 })), 100);
  const rows = [guide("a", [zero]), guide("b", [line("4000 PSI", 1, 100), service("Servicio sin precio", 1, null)])];
  const result = buildConcreteControl(dispatch("a", rows));
  assert.equal(result.total.value, null);
  assert.equal(result.total.known, 100);
  assert.equal(result.total.pending, 1);
  assert.equal(result.concrete.value, 100);
});

test("la consulta conserva snapshots numéricos cero y deja los históricos ausentes en null", () => {
  const row = radar.makeRadarGuide({ id: "a" }, [{ quantity: 1, unit_price: "0", estimated_subtotal: "0", currency: "GTQ" }, { quantity: 1, unit_price: null, estimated_subtotal: "", currency: null }]);
  assert.equal(row.lines[0].unitPrice, 0);
  assert.equal(row.lines[0].estimatedSubtotal, 0);
  assert.equal(row.lines[1].unitPrice, null);
  assert.equal(row.lines[1].estimatedSubtotal, null);
  assert.equal(row.lines[1].currency, null);
});

const cell = (sheet, row, header) => sheet.getCell(row, sheet.getRow(5).values.indexOf(header));

test("Observaciones consolida las notas distintas del elemento a fundir", async () => {
  const note = "Columnas del eje A\nFundir hasta nivel 2.";
  const rows = [
    radar.makeRadarGuide({ id: "notes", guide_number: "001", details: { observations: "Nota general distinta", castingElementObservations: note } }, [{ catalog_type: "PRODUCT", product_description: "Sin PSI", quantity: 2, unit_code: "M3", unit_price: 100, currency: "GTQ" }]),
    radar.makeRadarGuide({ id: "legacy", guide_number: "002", details: { observations: "Nota histórica general", castingElementObservations: note } }, []),
    radar.makeRadarGuide({ id: "empty", guide_number: "003", details: { observations: "Otra nota general", castingElementObservations: "Revisar eje B." } }, []),
  ];
  assert.equal(rows[0].observations, "Nota general distinta");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildConcreteControlWorkbook([dispatch("notes", rows)]).xlsx.writeBuffer());
  const sheet = workbook.worksheets[0];
  assert.equal(cell(sheet, 6, "Observaciones").value, `${note}\nRevisar eje B.`);
  assert.match(JSON.stringify(cell(sheet, 6, "Observaciones").note), /sin resistencia PSI/);
  assert.match(JSON.stringify(cell(sheet, 6, "Observaciones").note), /2 guía\(s\) sin líneas/);
  assert.equal(sheet.rowCount, 7);
});

test("Excel reabierto: una fila por despacho aunque sus guías tengan distintos PSI, precios y servicios", async () => {
  const a = guide("a", [line("4000 PSI", 2, 1000), service("Bomba", 8, 100)], { laboratory: true });
  const b = guide("b", [
    line("4000 PSI", 4, 1250),
    line("Concreto cotizado", 2, null, { resistancePsi: 3500, quotationUnitPrice: 900 }),
    line("Material adicional", 1, 25, { unit: "UN" }),
    service("Colocación", 8, 50),
    service("Recargo", 1, 40, { unit: "UN" }),
  ]);
  const selected = radar.selectRadarDispatches(radar.filterRadarDispatches([dispatch("a", [a, b])], { dateFrom: "2026-11-01", dateTo: "2026-11-30", guide: a.number }), ["a"]);
  const second = dispatch("b", [guide("a", [line("5000 PSI", 2, 1234.56), service("Bomba", 2, 100), service("Colocación", 2, 50)])]);
  second.orderNumber = "000042";
  second.summary.productInvoice.number = "0000012345";
  second.summary.serviceInvoice.number = "FACT-B";
  second.scheduledAt = "2026-11-03T03:00:00Z";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildConcreteControlWorkbook([...selected, second]).xlsx.writeBuffer());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Sistema de control"]);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 8);
  assert.equal(sheet.getRow(5).values.includes("No. de guía"), false);
  assert.deepEqual([6, 7].map((r) => cell(sheet, r, "Despacho").value), ["DSP-a", "DSP-b"]);
  assert.deepEqual([6, 7].map((r) => cell(sheet, r, "Programación").value), ["PRG-a", "PRG-b"]);
  assert.equal(cell(sheet, 7, "Fecha programada").value.toISOString(), "2026-11-02T00:00:00.000Z");

  assert.equal(cell(sheet, 6, "4000 PSI (m³)").value, 6);
  assert.ok(Math.abs(cell(sheet, 6, "Costo 4000 PSI (Q/m³)").value - 7000 / 6) < 1e-10);
  assert.equal(cell(sheet, 6, "Subtotal 4000 PSI (Q)").value, 7000);
  assert.equal(cell(sheet, 6, "3500 PSI (m³)").value, 2);
  assert.equal(cell(sheet, 6, "Costo 3500 PSI (Q/m³)").value, 900);
  assert.equal(cell(sheet, 6, "Subtotal 3500 PSI (Q)").value, 1800);
  assert.equal(cell(sheet, 6, "Volumen despachado de concreto (m³)").value, 8);
  assert.equal(cell(sheet, 6, "Subtotal concreto (Q)").value, 8800);
  assert.equal(cell(sheet, 6, "Subtotal producto (Q)").result, 8825);
  assert.equal(cell(sheet, 6, "Volumen bomba + colocación (m³)").value, 8);
  assert.equal(cell(sheet, 6, "Subtotal bomba + colocación (Q)").value, 1200);
  assert.equal(cell(sheet, 6, "Subtotal servicio (Q)").result, 1240);
  assert.equal(cell(sheet, 6, "Total concreto consumido (m³)").result, 8);
  assert.equal(cell(sheet, 6, "Total (Q)").result, 10065);
  assert.match(cell(sheet, 6, "Detalle de servicios y otros productos").value, /Colocación · 8\.000 m³ · Unitario GTQ 50\.0000 · Subtotal GTQ 400\.00/);
  assert.match(JSON.stringify(cell(sheet, 6, "Observaciones").note), /precio de cotización/);
  assert.equal(cell(sheet, 6, "Laboratorio").fill.fgColor.argb, "FFFFE066");
  assert.equal(cell(sheet, 6, "Factura producto").value, "FACT-CONCRETO");
  assert.equal(cell(sheet, 6, "Factura servicio").value, "FACT-SERVICIO");
  assert.equal(cell(sheet, 7, "Factura producto").value, "0000012345");
  assert.equal(cell(sheet, 7, "Factura servicio").value, "FACT-B");
  assert.equal(cell(sheet, 7, "Pedido").value, "000042");
  assert.equal(cell(sheet, 8, "Programación").value, "TOTAL GENERAL");
  assert.equal(cell(sheet, 8, "Total (Q)").result, 12834.12);
  assert.equal(cell(sheet, 8, "Volumen despachado de concreto (m³)").result, 10);
  assert.equal(cell(sheet, 8, "Subtotal servicio (Q)").result, 1540);
  assert.equal(cell(sheet, 8, "Factura producto").value, null);
  assert.equal(cell(sheet, 8, "Factura servicio").value, null);
  assert.match(sheet.autoFilter, /^A5:[A-Z]+7$/);
});

test("el total consolidado conserva ceros, resistencias sin identificar y datos pendientes", () => {
  const rows = [dispatch("one", [guide("one", [line("4000 PSI", 1, 0), service("Recargo", 1, 20, { unit: "UN" })])]), dispatch("two", [guide("two", [line("Sin PSI", 3, 100), service("Alisado", 2, 10, { unit: "M2" })])])];
  const sheet = buildConcreteControlWorkbook([...rows, dispatch("empty", [])]).worksheets[0];
  assert.equal(cell(sheet, 6, "Costo 4000 PSI (Q/m³)").value, 0);
  assert.equal(cell(sheet, 7, "Sin PSI identificado (m³)").value, 3);
  assert.equal(cell(sheet, 7, "Costo Sin PSI identificado (Q/m³)").value, 100);
  assert.equal(cell(sheet, 8, "Volumen despachado de concreto (m³)").value, "Pendiente");
  assert.equal(cell(sheet, 9, "Subtotal concreto (Q)").result, 300);
  assert.equal(cell(sheet, 9, "Recargo (Q)").result, 20);
  assert.equal(cell(sheet, 9, "Alisado (Q)").result, 20);
  assert.equal(cell(sheet, 9, "Total (Q)").result, 340);
  assert.equal(cell(sheet, 9, "Total concreto consumido (m³)").result, 2);
  const missing = buildConcreteControlWorkbook([dispatch("usd", [guide("usd", [line("4000 PSI", 1, 10, { currency: "USD" }), service("Bomba", 1, 50, { unit: "UN" })])]), dispatch("empty", [])]).worksheets[0];
  assert.equal(cell(missing, 6, "Costo 4000 PSI (Q/m³)").value, "Pendiente");
  assert.equal(cell(missing, 6, "Volumen bomba + colocación (m³)").value, "Pendiente");
  assert.equal(cell(missing, 7, "Programación").value, "PRG-empty");
  assert.equal(cell(missing, 7, "Volumen despachado de concreto (m³)").value, "Pendiente");
  assert.match(cell(missing, 7, "Observaciones").note, /sin guías/);
  assert.equal(cell(missing, 8, "Subtotal producto (Q)").result, "Pendiente");
  assert.equal(cell(missing, 8, "Total concreto consumido (m³)").result, "Pendiente");
});

const routeSource = await readFile(new URL("../src/app/(dashboard)/reports/concrete-control/export/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint(projects = [{ id: "qa" }]) {
  const calls = [], exports = {};
  const NextResponse = class extends Response { static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }); } };
  const imports = { "next/server": { NextResponse }, "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "actor" }) }, "@/features/reports/report-scope": { getRadarProjectScope: async (id) => { calls.push({ id }); return projects; } }, "@/features/reports/radar": radar, "@/features/reports/radar-queries": { getCastingRadar: async (_projects, filters) => { calls.push({ filters }); return { dispatches: [dispatch("a", [guide("a", [line("4000 PSI", 1, 100)])])] }; } }, "@/features/reports/concrete-control-workbook": { buildConcreteControlWorkbook } };
  runInNewContext(compiled, { exports, Response, Uint8Array, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, run: (body) => exports.POST({ nextUrl: new URL("http://localhost/reports/concrete-control/export?scope=universal&from=2026-11-01&to=2026-11-30&truck=183"), json: async () => body }) };
}

test("exportación valida permisos, selección, filtros y genera un XLSX autorizado", async () => {
  const denied = endpoint([]);
  assert.equal((await denied.run({ dispatchIds: ["a"] })).status, 403);
  assert.equal(denied.calls.length, 1);
  for (const body of [null, {}, { dispatchIds: [] }, { dispatchIds: [null] }, { dispatchIds: Array(101).fill("a") }]) {
    const f = endpoint();
    assert.equal((await f.run(body)).status, 400);
    assert.equal(f.calls.length, 1);
  }
  assert.equal((await endpoint().run({ dispatchIds: ["foreign"] })).status, 400);
  const f = endpoint(), response = await f.run({ dispatchIds: ["a", "a"] });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0], { id: "actor" });
  assert.equal(f.calls[1].filters.truck, "183");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Content-Disposition"), /sistema-de-control-2026-11-01-2026-11-30.xlsx/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["Sistema de control"]);
});
