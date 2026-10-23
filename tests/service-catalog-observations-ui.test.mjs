import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { catalogSelectionDefaults } from "../src/features/dispatches/catalog-selection.ts";

const jsx = (type, props, key) => ({ type, props, key });
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function hooks() {
  let index = 0;
  const state = [];
  return {
    reset() { index = 0; },
    useState(initial) {
      const position = index++;
      if (!(position in state)) state[position] = initial;
      return [state[position], value => { state[position] = typeof value === "function" ? value(state[position]) : value; }];
    },
  };
}
async function load(file, imports, globals = {}) {
  const source = await readFile(new URL(`../src/features/dispatches/components/${file}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, ...globals, require(path) {
    assert.ok(Object.hasOwn(imports, path), path);
    return imports[path];
  } });
  return exports;
}
const service = { id: "service-one", type: "SERVICE", code: "86180185", reference: null,
  description: "Dosis extra de retardante", observations: "Una dosis", unitCode: "M3", price: 10.92, currency: "GTQ" };
const otherService = { ...service, id: "service-two", observations: "Doble dosis", price: 21.84 };
const shared = {
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  "lucide-react": {}, "@/components/ui/button": { Button: "Button" },
  "@/components/ui/dialog": { Dialog: "Dialog", DialogFooter: "DialogFooter" },
  "../formatters": { formatDispatchMoney: value => `Q ${value.toFixed(2)}` },
};

for (const kind of ["SERVICE", "PRODUCT"]) {
  test(`${kind}: observaciones solo se muestran en servicios y cada botón selecciona el ID y precio correctos`, async () => {
    const h = hooks();
    let effect, task, selected;
    const { DispatchCatalogPickerDialog } = await load("dispatch-catalog-picker-dialog", {
      ...shared, react: { useState: h.useState, useEffect: callback => { effect = callback; } },
      "../actions": { searchDispatchCatalogAction: async (project, type) => {
        assert.equal(project, "project"); assert.equal(type, kind);
        return { status: "success", items: [service, otherService].map(item => ({ ...item, type: kind })) };
      } },
    }, { window: { setTimeout: callback => { task = callback(); return 1; }, clearTimeout() {} } });
    let tree;
    const render = () => { h.reset(); tree = DispatchCatalogPickerDialog({ projectId: "project", initialType: kind, onSelect: item => { selected = item; }, onClose() {} }); };
    render(); effect(); await task; render();
    assert.equal(tree.props.size, kind === "SERVICE" ? "xl" : "lg");
    assert.match(nodes(tree).find(node => node.type === "table").props.className, kind === "SERVICE" ? /min-w-\[48rem\]/u : /min-w-\[34rem\]/u);
    const headers = nodes(tree).filter(node => node.type === "th").map(node => node.props.children);
    assert.equal(headers.includes("Observaciones"), kind === "SERVICE");
    const rows = nodes(tree).filter(node => node.type === "tr" && node.key);
    assert.deepEqual(rows.map(row => row.key), ["service-one", "service-two"]);
    const cells = nodes(rows[1]).filter(node => node.type === "td").map(node => node.props.children);
    assert.equal(cells.includes("Doble dosis"), kind === "SERVICE");
    nodes(rows[1]).find(node => node.type === "button").props.onClick();
    assert.equal(selected.id, "service-two");
    assert.equal(selected.price, 21.84);
  });
}

test("seleccionar servicio deja descripción, UM, ID y precio en la guía, sin observaciones visibles ni enviadas", async () => {
  const h = hooks();
  const { DispatchGuideDialog } = await load("dispatch-guide-dialog", {
    ...shared,
    react: { useState: h.useState, useEffect() {}, useMemo: fn => fn(), useActionState: () => [{ status: "idle" }, () => {}, false] },
    "next/navigation": { useRouter: () => ({}) },
    "@/components/feedback/loading-button": { LoadingButton: "LoadingButton" },
    "@/components/feedback/use-action-notification": { useActionNotification() {} },
    "@/components/ui/icon-button": { IconButton: "IconButton" },
    "@/lib/notification-messages": { notifications: {} },
    "../actions": {}, "../catalog-selection": { catalogSelectionDefaults },
    "../../platform/project-price-catalogs/service-units": { SERVICE_UNIT_CODES: ["M3", "UN"] },
    "../types": {}, "./dispatch-catalog-picker-dialog": { DispatchCatalogPickerDialog: "Picker" },
  });
  let tree;
  const render = () => { h.reset(); tree = DispatchGuideDialog({ projectId: "project", programmingId: "programming", dispatchId: "dispatch", expectedVersion: 1, programmedUnitCode: "M3", units: [{ code: "M3" }], onClose() {} }); };
  render();
  nodes(tree).find(node => node.type === "button" && nodes(node).some(child => child.props?.children === "Seleccionar del catálogo")).props.onClick();
  render();
  nodes(tree).find(node => node.type === "Picker").props.onSelect(otherService);
  render();
  assert.equal(nodes(tree).find(node => node.props?.name === "lineProductDescription").props.value, service.description);
  assert.equal(nodes(tree).find(node => node.props?.name === "lineCatalogItemId").props.value, "service-two");
  assert.equal(nodes(tree).find(node => node.props?.name === "lineUnitCode").props.value, "M3");
  assert.ok(nodes(tree).some(node => node.props?.children === "Q 21.84 c/u" || (Array.isArray(node.props?.children) && node.props.children.join("") === "Q 21.84 c/u")));
  assert.ok(!nodes(tree).some(node => node.props?.value === "Doble dosis" || node.props?.children === "Doble dosis" || /observations/iu.test(node.props?.name ?? "")));
});
