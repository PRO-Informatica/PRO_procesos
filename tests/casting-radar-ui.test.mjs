import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import ExcelJS from "exceljs";
import * as radar from "../src/features/reports/radar.ts";
import { CASTING_ELEMENTS } from "../src/features/dispatches/casting-elements.ts";
import { buildRadarWorkbook } from "../src/features/reports/radar-workbook.ts";

const source = await readFile(new URL("../src/features/reports/components/casting-radar.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children), ...nodes(node.props?.selection)];
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const filters = { dateFrom: "2026-11-01", dateTo: "2026-11-30", dispatch: "DSP", castingElement: "PILES" };

function fixture(count = 10) {
  const state = [], calls = [], notifications = [];
  let cursor = 0, downloaded;
  const dispatches = Array.from({ length: count }, (_, i) => ({ id: `d${i}`, code: `DSP-${i}`, scheduledAt: "2026-11-03T13:00:00Z", timezone: "America/Guatemala", projectName: "Proyecto QA", projectId: "qa", supplierName: "Proveedor QA", orderNumber: "88", programmingCode: "PRG-QA", summary: { castingElementLabel: "Pilotes" }, guides: [radar.makeRadarGuide({ id: `g${i}`, guide_number: `000${i}`, guide_date: "2026-11-03" }, [], "PILES")] }));
  const link = () => {}, button = () => {}, card = () => {};
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; } },
    "next/link": { default: link }, "lucide-react": {},
    "@/components/feedback/empty-state": {}, "@/components/feedback/loading-button": { LoadingButton: button },
    "@/components/motion/motion-page": {}, "@/components/motion/motion-section": {},
    "@/lib/notify": { notify: { error: (...args) => notifications.push(args), success: (...args) => notifications.push(args) } },
    "../radar": radar, "@/features/dispatches/casting-elements": { CASTING_ELEMENTS },
    "./dispatch-report-card": { DispatchReportCard: card }, "./report-sections": {},
  };
  const exports = {};
  runInNewContext(compiled, {
    exports, Set, Intl,
    URL: { createObjectURL(blob) { downloaded = blob; return "blob:radar-qa"; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    setTimeout: (callback) => callback(),
    async fetch(url, options) {
      const ids = JSON.parse(options.body).dispatchIds;
      calls.push({ url, ids });
      const buffer = await buildRadarWorkbook(radar.selectRadarDispatches(dispatches, ids)).xlsx.writeBuffer();
      return { ok: true, blob: async () => buffer };
    },
    require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  });
  return { calls, notifications, card, button, downloaded: () => downloaded, render() { cursor = 0; return nodes(exports.CastingRadar({ data: { dispatches, projects: [] }, filters, universal: true })); } };
}

test("la vista muestra tarjetas de despacho y todos los filtros solicitados", () => {
  const f = fixture(), tree = f.render();
  assert.equal(tree.filter((node) => node.type === f.card).length, 8);
  assert.equal(tree.filter((node) => node.type === "table").length, 0);
  assert.ok(tree.some((node) => node.type === "h2" && text(node) === "Filtros por despacho"));
  for (const name of ["from", "to", "guide", "dispatch", "truck", "concrete", "laboratory", "castingElement", "project"]) assert.ok(tree.some((node) => node.props?.name === name), name);
  assert.equal(tree.find((node) => node.type === f.button).props.disabled, true);
});

test("la selección conserva despachos entre páginas y descarga exactamente dos hojas", async () => {
  const f = fixture();
  for (const id of ["DSP-0", "DSP-1"]) f.render().find((node) => node.props?.["aria-label"] === `Seleccionar ${id}`).props.onChange({ target: { checked: true } });
  f.render().find((node) => node.type === "button" && text(node).includes("Siguiente")).props.onClick();
  let tree = f.render();
  assert.equal(tree.filter((node) => node.type === f.card).length, 2);
  assert.ok(tree.some((node) => text(node) === "10 despacho(s) · 2 seleccionado(s)"));
  await tree.find((node) => node.type === f.button).props.onClick();
  assert.deepEqual(f.calls[0].ids, ["d0", "d1"]);
  const query = new URL(f.calls[0].url, "http://localhost").searchParams;
  assert.equal(query.get("scope"), "universal");
  assert.equal(query.get("dispatch"), "DSP");
  assert.equal(query.get("castingElement"), "PILES");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(f.downloaded());
  assert.deepEqual(workbook.worksheets.map(({ name }) => name), ["DSP-0", "DSP-1"]);
  assert.equal(workbook.worksheets[0].getCell("A8").value, "0000");
  tree = f.render();
  tree.find((node) => node.type === "button" && text(node) === "Quitar selección").props.onClick();
  assert.equal(f.render().find((node) => node.type === f.button).props.disabled, true);
});

test("seleccionar todos respeta el límite de cien despachos y avisa al excederlo", () => {
  const f = fixture(101);
  f.render().find((node) => node.type === "button" && text(node) === "Seleccionar primeros 100").props.onClick();
  for (let page = 1; page < 13; page++) f.render().find((node) => node.type === "button" && text(node).includes("Siguiente")).props.onClick();
  f.render().find((node) => node.props?.["aria-label"] === "Seleccionar DSP-100").props.onChange({ target: { checked: true } });
  assert.ok(f.notifications.some(([title]) => title === "Límite de selección"));
  assert.ok(f.render().some((node) => text(node) === "101 despacho(s) · 100 seleccionado(s)"));
});
