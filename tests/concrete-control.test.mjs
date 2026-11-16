import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { buildConcreteControl, concreteStrength, controlLineCategory, controlLineSubtotal, makeConcreteControlRow } from "../src/features/reports/concrete-control.ts";
import { buildConcreteControlWorkbook } from "../src/features/reports/concrete-control-workbook.ts";
import * as radar from "../src/features/reports/radar.ts";

const line = (description, quantity, unitPrice, changes = {}) => ({ type: "PRODUCT", code: "86131064", reference: "CONF4001", description, quantity, unit: "M3", unitPrice, estimatedSubtotal: null, currency: "GTQ", ...changes });
const service = (description, quantity, unitPrice, changes = {}) => line(description, quantity, unitPrice, { type: "SERVICE", reference: "", code: "SERV-QA", ...changes });
const guide = (id, lines, changes = {}) => ({ ...radar.makeRadarGuide({ id, guide_number: `000-${id}`, guide_date: "2026-11-03", laboratory_applied: false, details: { truck: "183" } }, [], "PILES"), lines, ...changes });
const dispatch = (id, guides) => ({ id, code: `DSP-${id}`, programmingCode: `PRG-${id}`, orderNumber: "88", projectId: "acoat", projectName: "ACOAT", supplierName: "Proveedor QA", scheduledAt: "2026-11-03T13:00:00Z", timezone: "America/Guatemala", guides, summary: { productInvoice: { number: "FACT-CONCRETO", total: 12345, currency: "GTQ" }, serviceInvoice: { number: "FACT-SERVICIO", total: 500, currency: "GTQ" } } });

test("PSI explícito y costos históricos, sin inventar resistencia desde códigos", () => {
  for (const value of ["4000 PSI", "4,000 PSI", "4.000 PSI", "4 000 psi"]) assert.equal(concreteStrength(line(value, 1, 100)), 4000);
  assert.equal(concreteStrength(line("Concreto fluido", 1, 100)), null);
  const row = makeConcreteControlRow(guide("a", [line("4000 PSI", 2, 100), line("4000 PSI", 3, 200), line("3500 PSI", 1, 300), line("Sin resistencia", 2, 150)]));
  assert.equal(row.concreteVolume, 8);
  assert.equal(row.concrete.value, 1400);
  assert.equal(row.strengths.find((s) => s.label === "4000 PSI").unitPrice, 160);
  assert.equal(row.strengths.find((s) => s.label === "3500 PSI").quantity, 1);
  assert.equal(row.strengths.find((s) => s.label === "Sin resistencia identificada").quantity, 2);
  assert.equal(row.total.value, 1400);
  assert.ok(row.warnings.some((w) => w.includes("sin resistencia")));
});

test("bomba y colocación no duplican volumen; consumo conserva el promedio del Excel", () => {
  const row = makeConcreteControlRow(guide("a", [line("5000 PSI", 6.5, 1000), service("BOMBA + OPERADOR", 6, 80.64), service("Colocación región", 6, 93.8), service("Recargo nocturno", 1, 50, { unit: "UN" }), service("Alisado", 1, 40, { unit: "M2" }), service("Tubo adicional", 13, 12.6, { unit: "UN" })]));
  assert.equal(row.pumpingVolume, 6);
  assert.equal(row.consumedVolume, 6.25);
  assert.equal(row.pumping.value, 1046.64);
  assert.equal(row.surcharge.value, 50);
  assert.equal(row.finishing.value, 40);
  assert.equal(row.other.value, 163.8);
  assert.equal(row.total.value, 7800.44);
  assert.equal(controlLineCategory(line("Material", 1, 10, { unit: "UN" })), "other");
  const onlyService = makeConcreteControlRow(guide("b", [service("Colocación región", 10, 100)]));
  assert.equal(onlyService.concreteVolume, 0);
  assert.equal(onlyService.consumedVolume, 5);
  const noService = makeConcreteControlRow(guide("c", [line("4000 PSI", 10, 100)]));
  assert.equal(noService.pumpingVolume, 0);
  assert.equal(noService.consumedVolume, 5);
});

test("volumen de servicios desconocido o contradictorio queda pendiente", () => {
  const different = makeConcreteControlRow(guide("a", [service("Bombeo", 5, 10), service("Colocación", 6, 10)]));
  assert.equal(different.pumpingVolume, null);
  assert.equal(different.consumedVolume, null);
  assert.equal(different.total.value, 110);
  const missing = makeConcreteControlRow(guide("b", [service("Bomba", 1, 100, { unit: "UN" })]));
  assert.equal(missing.pumpingVolume, null);
  const paired = makeConcreteControlRow(guide("c", [service("Bomba", 1, 100, { unit: "UN" }), service("Colocación", 8, 10)]));
  assert.equal(paired.pumpingVolume, 8);
  assert.equal(makeConcreteControlRow(guide("zero", [service("Bomba", 0, null, { unit: "UN" })])).pumpingVolume, 0);
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
  assert.equal(result.totals.total.value, null);
  assert.equal(result.totals.total.known, 100);
  assert.equal(result.totals.total.pending, 1);
  assert.equal(result.totals.concrete.value, 100);
});

test("la consulta conserva snapshots numéricos cero y deja los históricos ausentes en null", () => {
  const row = radar.makeRadarGuide({ id: "a" }, [{ quantity: 1, unit_price: "0", estimated_subtotal: "0", currency: "GTQ" }, { quantity: 1, unit_price: null, estimated_subtotal: "", currency: null }]);
  assert.equal(row.lines[0].unitPrice, 0);
  assert.equal(row.lines[0].estimatedSubtotal, 0);
  assert.equal(row.lines[1].unitPrice, null);
  assert.equal(row.lines[1].estimatedSubtotal, null);
  assert.equal(row.lines[1].currency, null);
});

test("Excel reabierto: una sola hoja con todas las guías, campos del control y total general", async () => {
  const a = guide("a", [line("4000 PSI", 6.5, 1000), service("Bomba", 6, 100), service("Colocación", 6, 50)], { laboratory: true });
  const b = guide("b", [service("Recargo", 1, null, { unit: "UN" })]);
  const selected = radar.selectRadarDispatches(radar.filterRadarDispatches([dispatch("a", [a, b])], { dateFrom: "2026-11-01", dateTo: "2026-11-30", guide: a.number }), ["a"]);
  const workbook = new ExcelJS.Workbook();
  const c = guide("a", [line("5000 PSI", 2, 1234.56), service("Bomba", 2, 100), service("Colocación", 2, 50)]);
  const second = dispatch("b", [c]);
  second.orderNumber = "000042";
  second.summary.productInvoice.number = "0000012345";
  second.summary.serviceInvoice.number = "FACT-B";
  await workbook.xlsx.load(await buildConcreteControlWorkbook([...selected, second, dispatch("empty", [])]).xlsx.writeBuffer());
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["Control de concreto"]);
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(5).values.slice(1), ["Despacho", "Pedido", "No. de guía", "Fecha", "Camión", ...[4000, 5000, 6000, 7000, 8000].flatMap((psi) => [`Resistencia ${psi} PSI (m³)`, `Costo ${psi} PSI (Q/m³)`]), "Otros PSI / sin identificar (m³)", "Costo otros (Q/m³)", "Total volumen Concreto (m³)", "Subtotal concreto (Q)", "Factura Concreto", "Volumen Bomba + Colocación (m³)", "Subtotal Bomba + Colocación (Q)", "Factura Bombeo", "Total concreto consumido (m³)", "Recargo (Q)", "Alisado (Q)", "Otros productos / servicios (Q)", "Total (Q)", "Laboratorio", "Elemento a fundir", "Observaciones"]);
  assert.deepEqual([6, 7, 8, 9].map((r) => sheet.getCell(r, 1).value), ["DSP-a", "DSP-a", "DSP-b", "DSP-empty"]);
  assert.deepEqual([6, 7, 8].map((r) => sheet.getCell(r, 3).value), [a.number, b.number, c.number]);
  assert.equal(sheet.getCell("D6").value instanceof Date, true);
  assert.equal(sheet.getCell("F6").value, 6.5);
  assert.equal(sheet.getCell("S6").value.result, 6500);
  assert.equal(sheet.getCell("U6").value, 6);
  assert.equal(sheet.getCell("V6").value.result, 900);
  assert.equal(sheet.getCell("AB6").value.result, 7400);
  assert.equal(sheet.getCell("X6").value.formula, 'IF(COUNT(R6,U6)=2,(R6+U6)/2,"Pendiente")');
  assert.equal(sheet.getCell("X6").value.result, 6.25);
  assert.equal(sheet.getCell("Y7").value.result, "Pendiente");
  assert.equal(sheet.getCell("AB10").value.result, "Pendiente");
  assert.equal(sheet.getCell("X10").value.result, 8.25);
  assert.equal(sheet.getCell("R10").value.result, 8.5);
  assert.equal(sheet.getCell("S10").value.result, 8969.12);
  assert.equal(sheet.getCell("V10").value.result, 1200);
  assert.equal(sheet.getCell("AE6").fill.fgColor.argb, "FFFFE066");
  assert.equal(sheet.getCell("A7").fill.fgColor?.argb, undefined);
  assert.equal(sheet.getCell("T6").value, "FACT-CONCRETO");
  assert.equal(sheet.getCell("W6").value, "FACT-SERVICIO");
  assert.equal(sheet.getCell("T8").value, "0000012345");
  assert.equal(sheet.getCell("W8").value, "FACT-B");
  assert.equal(sheet.getCell("B8").value, "000042");
  assert.equal(sheet.getCell("C9").value, "Sin guías registradas");
  assert.equal(sheet.getCell("A10").value, "TOTAL GENERAL");
  assert.equal(sheet.getCell("T10").value, null); // Invoice references are not summed or allocated to guides.
  assert.equal(sheet.getCell("W10").value, null);
  assert.equal(sheet.getCell("A4").value.includes("/ 2"), true);
  assert.equal(sheet.autoFilter, "A5:AE9");
  // Each guide's category formulas point at its own detail, including repeated guide numbers in other dispatches.
  let detailStart;
  sheet.eachRow((r) => { if (r.getCell(1).value === `DSP-b · Detalle de guía ${c.number} · ${radar.radarDate(c.date)}`) detailStart = r.number + 2; });
  assert.ok(detailStart);
  assert.match(sheet.getCell("S8").value.formula, new RegExp(`I${detailStart}(?:,|\\))`));
});

test("el total consolidado no duplica subtotales y conserva pendientes, moneda y ceros", async () => {
  const rows = [dispatch("one", [guide("one", [line("4000 PSI", 1, 0), service("Recargo", 1, 20, { unit: "UN" })])]), dispatch("two", [guide("two", [line("Sin PSI", 3, 100), service("Alisado", 2, 10, { unit: "M2" })])])];
  const sheet = buildConcreteControlWorkbook(rows).worksheets[0];
  assert.equal(sheet.getCell("G6").value, 0);
  assert.equal(sheet.getCell("P7").value, 3);
  assert.equal(sheet.getCell("Q7").value, 100);
  assert.equal(sheet.getCell("S8").value.result, 300);
  assert.equal(sheet.getCell("Y8").value.result, 20);
  assert.equal(sheet.getCell("Z8").value.result, 20);
  assert.equal(sheet.getCell("AB8").value.result, 340);
  assert.equal(sheet.getCell("X8").value.result, 2);
  assert.equal(sheet.getCell("AB8").value.formula, 'IF(COUNT(AB6:AB7)=2,SUM(AB6:AB7),"Pendiente")');
  const missing = buildConcreteControlWorkbook([dispatch("usd", [guide("usd", [line("4000 PSI", 1, 10, { currency: "USD" }), service("Bomba", 1, 50, { unit: "UN" })])])]).worksheets[0];
  assert.equal(missing.getCell("G6").value, "Pendiente");
  assert.equal(missing.getCell("S7").value.result, "Pendiente");
  assert.equal(missing.getCell("U7").value.result, "Pendiente");
  assert.equal(missing.getCell("X7").value.result, "Pendiente");
  const empty = buildConcreteControlWorkbook([dispatch("empty", [])]).worksheets[0];
  assert.equal(empty.getCell("C6").value, "Sin guías registradas");
  assert.equal(empty.getCell("R7").value.result ?? 0, 0); // ExcelJS omits a zero cached result.
  assert.equal(empty.getCell("R7").value.formula, 'IF(COUNT(R6:R6)=0,SUM(R6:R6),"Pendiente")');
});

const routeSource = await readFile(new URL("../src/app/(dashboard)/reports/concrete-control/export/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint(projects = [{ id: "qa" }]) {
  const calls = [], exports = {};
  const NextResponse = class extends Response { static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }); } };
  const imports = { "next/server": { NextResponse }, "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "actor" }) }, "@/features/reports/report-scope": { getRadarProjectScope: async (id, universal) => { calls.push({ id, universal }); return projects; } }, "@/features/reports/radar": radar, "@/features/reports/radar-queries": { getCastingRadar: async (_projects, filters) => { calls.push({ filters }); return { dispatches: [dispatch("a", [guide("a", [line("4000 PSI", 1, 100)])])] }; } }, "@/features/reports/concrete-control-workbook": { buildConcreteControlWorkbook } };
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
  assert.equal(f.calls[0].universal, true);
  assert.equal(f.calls[1].filters.truck, "183");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Content-Disposition"), /control-concreto-2026-11-01-2026-11-30.xlsx/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["Control de concreto"]);
});
