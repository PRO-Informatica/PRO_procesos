import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseGuideReportFilters, reportSearchParams } from "../src/features/reports/filters.ts";
import { guideReportMetadata } from "../src/features/reports/guide-metadata.ts";
import { filterRadarDispatches, makeRadarGuide, parseRadarFilters, radarQueryDateRange, radarSearchParams, radarTime, radarTimeWithDate, selectRadarDispatches } from "../src/features/reports/radar.ts";
import { buildRadarWorkbook } from "../src/features/reports/radar-workbook.ts";

const filters = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };
const product = { position: 1, catalog_type: "PRODUCT", product_code: "86131064", catalog_reference: "CONF4001", product_description: "Concreto fluido", quantity: "6.5", unit_code: "M3" };
const service = { position: 2, catalog_type: "SERVICE", product_code: "SERV1014", product_description: "Tubo adicional", quantity: "13", unit_code: "UN" };
function guide(id, changes = {}, lines = [product, service]) {
  return makeRadarGuide({ id, guide_number: `6015-${id}`, guide_date: "2026-11-03", truck_arrival_at: "2026-11-04T05:00:00Z", truck_departure_at: "2026-11-04T09:20:00Z", details: { truck: "183", loadingTime: "18:27", documentType: "DISPATCH_GUIDE", observations: "Revisar descarga", customerName: "Cliente", projectName: "Obra leída", workAddress: "Dirección de obra" }, ...changes }, lines, "COLUMNS");
}
function dispatch(id, guides, changes = {}) {
  return { id, code: `DSP-${id}`, programmingCode: `PRG-${id}`, orderNumber: "88", projectId: "acoat", projectName: "ACOAT", supplierName: "MEZCLADORA, S.A.", scheduledAt: "2026-11-03T13:00:00Z", timezone: "America/Guatemala", summary: { castingElements: ["COLUMNS"], castingElementLabel: "Columnas" }, guides, ...changes };
}

test("las fechas directas del reporte se respetan aunque llegue un período anterior en la URL", () => {
  const result = parseGuideReportFilters(new URLSearchParams("period=month&from=2026-10-03&to=2026-10-06&orderStatus=CLOSED&castingElement=pilotes+y+columnas"));
  assert.equal(result.dateFrom, "2026-10-03");
  assert.equal(result.dateTo, "2026-10-06");
  assert.equal(result.castingElement, "PILES_AND_COLUMNS");
  assert.equal("period" in result, false);
  assert.equal("orderStatus" in result, false);
  const query = reportSearchParams(result);
  assert.equal(query.get("castingElement"), "PILES_AND_COLUMNS");
  assert.equal(query.has("period"), false);
  assert.equal(query.has("orderStatus"), false);
});

test("los rangos invertidos se corrigen y los filtros de radar sobreviven al exportar", () => {
  const result = parseRadarFilters({ from: "2026-11-30", to: "2026-11-01", dispatch: " DSP-ABC ", castingElement: "pilotes y columnas", truck: " 183 ", guide: "6015", concrete: "CONF4001", laboratory: "yes", project: "acoat" });
  assert.deepEqual(result, { ...filters, dispatch: "DSP-ABC", castingElement: "PILES_AND_COLUMNS", truck: "183", guide: "6015", concrete: "CONF4001", laboratory: "yes", projectId: "acoat" });
  assert.equal(radarSearchParams(result, true).get("scope"), "universal");
  assert.deepEqual(parseRadarFilters(radarSearchParams(result)), result);
});

test("la reportería resume elementos, camiones únicos y laboratorio por guía", () => {
  const result = guideReportMetadata([
    { casting_element: "PILES", details: { truck: " 183 " }, laboratory_applied: true },
    { details: { truck: "183" }, laboratory_applied: false },
    { casting_element: "COLUMNS", details: ["no es un objeto de campos"] },
  ], "COLUMNS");
  assert.deepEqual(result.castingElements, ["PILES", "COLUMNS"]);
  assert.deepEqual(result.trucks, ["183"]);
  assert.equal(result.castingElementLabel, "Pilotes, Columnas");
  assert.equal(result.laboratoryLabel, "Sí (1 de 3 guías)");
  assert.equal(guideReportMetadata([], "PILES").castingElementLabel, "Pilotes");
  assert.equal(guideReportMetadata([]).laboratoryLabel, "Sin guías");
  assert.equal(guideReportMetadata([{}]).laboratoryLabel, "No");
});

test("el radar combina criterios por despacho y conserva todas sus guías", () => {
  const a = guide("a", { laboratory_applied: true });
  const b = guide("b", { guide_date: "2026-10-31", details: { truck: "280" } });
  const data = [dispatch("1", [a, b]), dispatch("2", [guide("c", { details: { truck: "280" }, laboratory_applied: false })])];
  assert.equal(filterRadarDispatches(data, { ...filters, truck: "280", laboratory: "yes" }).length, 1);
  const result = filterRadarDispatches(data, { ...filters, truck: "183", laboratory: "yes" });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].guides.map(({ id }) => id), ["a", "b"]);
  assert.equal(filterRadarDispatches(data, { ...filters, projectId: "otro" }).length, 0);
  assert.equal(filterRadarDispatches(data, { ...filters, guide: "6015-c", laboratory: "no" }).length, 1);
  assert.equal(filterRadarDispatches(data, { ...filters, guide: "6015c", laboratory: "no" }).length, 1);
});

test("la fecha pertenece al despacho, incluye despachos sin guías y respeta la zona del proyecto", () => {
  const data = [dispatch("vacío", []), dispatch("fuera", [guide("a")], { scheduledAt: "2026-10-31T13:00:00Z" }), dispatch("borde", [guide("b", { guide_date: "2026-10-15" })], { scheduledAt: "2026-12-01T05:59:59Z" }), dispatch("diciembre", [guide("c")], { scheduledAt: "2026-12-01T06:00:00Z" })];
  assert.deepEqual(filterRadarDispatches(data, filters).map(({ id }) => id), ["vacío", "borde"]);
  assert.deepEqual(radarQueryDateRange(filters), { dateFrom: "2026-10-31", dateTo: "2026-12-01" });
  assert.deepEqual(filterRadarDispatches(data, { ...filters, dispatch: "DSP-VACÍO", castingElement: "COLUMNS" }).map(({ id }) => id), ["vacío"]);
  assert.equal(filterRadarDispatches(data, { ...filters, castingElement: "PILES" }).length, 0);
  assert.equal(filterRadarDispatches([data[0]], { ...filters, laboratory: "no" }).length, 0);
});

test("laboratorio No excluye despachos mixtos y los filtros de guía no recortan el Excel", () => {
  const mixed = dispatch("mixto", [guide("a", { laboratory_applied: true }), guide("b")]);
  const noLab = dispatch("sin-lab", [guide("c")]);
  assert.deepEqual(filterRadarDispatches([mixed, noLab], { ...filters, laboratory: "no" }).map(({ id }) => id), ["sin-lab"]);
  const selected = filterRadarDispatches([mixed], { ...filters, guide: "6015-b", laboratory: "yes", dispatch: "mixto" });
  assert.equal(selected[0].guides.length, 2);
});

test("la cantidad de concreto excluye servicios y otras unidades y permite buscar Servicio en guías mixtas", () => {
  const mixed = guide("a", {}, [service, { ...product, quantity: "1.25", unit_code: "m³" }, { ...product, position: 3, quantity: 100, unit_code: "UN" }, { ...service, quantity: 20, unit_code: "M3" }]);
  assert.equal(mixed.concreteQuantity, 1.25);
  assert.equal(mixed.concrete, "CONF4001");
  assert.equal(mixed.lines[0].type, "PRODUCT");
  const serviceOnly = guide("b", {}, [service]);
  assert.equal(serviceOnly.concreteQuantity, 0);
  assert.equal(serviceOnly.concrete, "Servicio");
  assert.equal(filterRadarDispatches([dispatch("1", [mixed])], { ...filters, concrete: "servicio" }).length, 1);
  assert.equal(filterRadarDispatches([dispatch("1", [mixed])], { ...filters, concrete: "SERV1014" }).length, 1);
  assert.equal(filterRadarDispatches([dispatch("1", [mixed])], { ...filters, concrete: "tubo adicional" }).length, 1);
});

test("los horarios respetan Guatemala, medianoche y el día siguiente", () => {
  assert.equal(radarTime("18:27", "America/Guatemala"), "18:27");
  assert.equal(radarTime("2026-11-04T06:00:00Z", "America/Guatemala"), "00:00");
  assert.equal(radarTimeWithDate("2026-11-04T05:00:00Z", "2026-11-03", "America/Guatemala"), "23:00");
  assert.equal(radarTimeWithDate("2026-11-04T09:20:00Z", "2026-11-03", "America/Guatemala"), "03:20 · 04/11/2026");
  assert.equal(radarTime(null, "America/Guatemala"), "—");
});

test("la selección de exportación rechaza identificadores ajenos, vacíos o excesivos", () => {
  const data = [dispatch("a", [guide("a")]), dispatch("b", [guide("b")])];
  assert.deepEqual(selectRadarDispatches(data, ["b", "a", "b"]).map(({ id }) => id), ["b", "a"]);
  for (const selection of [[], ["ajeno"], [null], Array(101).fill("a")]) assert.throws(() => selectRadarDispatches(data, selection));
});

test("el Excel reabierto contiene una hoja por despacho y toda la fila de laboratorio amarilla", async () => {
  const lab = guide("000543", { laboratory_applied: true, details: { truck: "183", loadingTime: "18:27", temperature: 21.8, slump: '8 1/2"', laboratoryNotes: "Muestreo No. 1", workAddress: "Dirección de obra" } });
  const ordinary = guide("000544");
  const workbook = buildRadarWorkbook([
    dispatch("a", [lab, ordinary], { code: "DSP-TEST" }),
    dispatch("b", [guide("b", {}, [service])], { code: "DSP-TEST" }),
  ]);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(reopened.worksheets.map(({ name }) => name), ["DSP-TEST", "DSP-TEST-2"]);
  const sheet = reopened.worksheets[0];
  assert.equal(sheet.getCell("A8").value, "6015-000543");
  assert.equal(sheet.getCell("B8").value, "183");
  assert.equal(sheet.getCell("C8").value, 6.5);
  assert.equal(sheet.getCell("E8").value, 21.8);
  assert.equal(sheet.getCell("F8").value.toISOString().slice(11, 16), "18:27");
  assert.equal(sheet.getCell("H8").value.toISOString(), "2026-11-04T03:20:00.000Z");
  assert.equal(sheet.getCell("H8").numFmt, 'hh:mm" · "dd/mm/yyyy');
  assert.equal(sheet.getCell("I8").value, '8 1/2"');
  assert.equal(sheet.getCell("J8").value, "Muestreo No. 1");
  assert.deepEqual(sheet.getCell("C23").value, { formula: "SUM(C8:C22)", result: 13 });
  assert.ok(sheet.model.merges.includes("F6:H6"));
  assert.ok(sheet.model.merges.includes("J6:J7"));
  assert.equal(sheet.getCell("J6").fill.fgColor.argb, "FFA9D18E");
  const allValues = sheet.getSheetValues().flat().filter((value) => typeof value === "string").join("\n");
  assert.match(allValues, /Servicio · 13 UN · SERV1014 · Tubo adicional/);
  assert.match(allValues, /Dirección de obra/);
  for (let column = 1; column <= 10; column++) {
    assert.equal(sheet.getRow(8).getCell(column).fill.fgColor.argb, "FFFFE066");
    assert.notEqual(sheet.getRow(9).getCell(column).fill?.fgColor?.argb, "FFFFE066");
  }
  assert.equal(reopened.worksheets[1].getCell("D8").value, "Servicio");
  assert.equal(reopened.worksheets[1].getCell("E8").value, null);
  assert.equal(reopened.worksheets[1].getCell("I8").value, null);
  assert.equal(sheet.views[0].ySplit, 7);
  assert.equal(sheet.columnCount, 10);
});

test("se exporta también un despacho sin guías con total cero y nombres de hoja únicos", async () => {
  const workbook = buildRadarWorkbook([dispatch("a", [], { code: "DSP-TEST" }), dispatch("b", [], { code: "dsp-test" })]);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(reopened.worksheets.map(({ name }) => name), ["DSP-TEST", "dsp-test-2"]);
  assert.equal(reopened.worksheets[0].getCell("A8").value, "Sin guías registradas");
  assert.equal(reopened.worksheets[0].getCell("C23").value.formula, "SUM(C8:C22)");
  assert.equal(reopened.worksheets[0].getCell("C23").result, 0);
});
