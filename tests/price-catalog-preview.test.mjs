import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const component = await readFile(new URL("../src/features/platform/project-price-catalogs/components/price-catalog-preview-table.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/features/platform/project-price-catalogs/components/import-price-catalog-dialog.tsx", import.meta.url), "utf8");
const jsx = (type, props, key) => ({ type, props, key });
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function load(source, imports) {
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(compiled, { exports, FormData, require(path) {
    assert.ok(Object.hasOwn(imports, path), path);
    return imports[path];
  } });
  return exports;
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
function preview(kind = "PRODUCT", count = 75, errorIndexes = [61, 72]) {
  const rows = Array.from({ length: count }, (_, index) => ({ rowNumber: index + 2,
    code: `C${index}`, reference: `CON.${index}`, description: `Servicio ${index}`, observations: `Observación ${index}`, unitCode: "M3", price: "0",
    errors: errorIndexes.includes(index) ? ["Error de prueba"] : [],
  }));
  const errorCount = rows.filter(row => row.errors.length).length;
  return { fileName: "catalogo.xlsx", catalogKind: kind, totalCount: count, validCount: count - errorCount, errorCount, rows };
}
function tableFixture(data, disabled = false) {
  const h = hooks();
  const { PriceCatalogPreviewTable } = load(component, {
    "react/jsx-runtime": { jsx, jsxs: jsx }, react: { useState: h.useState },
    "@/components/ui/button": { Button: "Button" },
  });
  let tree;
  const render = () => { h.reset(); tree = PriceCatalogPreviewTable({ preview: data, disabled }); };
  const find = predicate => nodes(tree).find(predicate);
  const rows = () => nodes(find(node => node.type === "tbody")).filter(node => node.type === "tr");
  const button = text => find(node => node.type === "Button" && node.props.children === text);
  render();
  return { find, rows, button, render,
    page(value) { find(node => node.type === "select").props.onChange({ target: { value } }); render(); },
    errorsOnly(checked) { find(node => node.type === "input").props.onChange({ target: { checked } }); render(); },
    next() { button("Siguiente").props.onClick(); render(); },
    previous() { button("Anterior").props.onClick(); render(); },
  };
}

for (const kind of ["PRODUCT", "SERVICE"]) {
  test(`${kind}: recorre las 75 filas, no solo las primeras 25, conservando números de Excel y precio 0`, () => {
    const f = tableFixture(preview(kind));
    const seen = [];
    assert.equal(f.button("Anterior").props.disabled, true);
    for (let page = 1; page <= 3; page++) {
      assert.equal(f.rows().length, 25);
      seen.push(...f.rows().map(row => nodes(row).find(node => node.type === "td").props.children));
      assert.equal(f.find(node => node.type === "select").props.value, page);
      assert.ok(nodes(f.rows()[0]).some(node => node.type === "td" && node.props.children === "0"));
      if (page !== 3) f.next();
    }
    assert.deepEqual(seen, Array.from({ length: 75 }, (_, index) => index + 2));
    assert.equal(f.button("Siguiente").props.disabled, true);
    f.previous();
    assert.equal(f.find(node => node.type === "select").props.value, 2);
    const cells = nodes(f.rows()[0]).filter(node => node.type === "td").map(node => node.props.children);
    if (kind === "SERVICE") assert.ok(cells.includes("Servicio 25") && cells.includes("M3") && cells.includes("Observación 25"));
    else { assert.ok(cells.includes("CON.25")); assert.ok(!cells.includes("Observación 25")); }
  });
}

test("puede saltar a la última página parcial y filtrar errores fuera de la primera página", () => {
  const f = tableFixture(preview("PRODUCT", 76));
  f.page("4");
  assert.equal(f.rows().length, 1);
  assert.equal(f.find(node => node.props?.role === "status").props.children.join(""), "Mostrando 76–76 de 76 registros.");
  f.errorsOnly(true);
  assert.equal(f.find(node => node.type === "select").props.value, 1);
  assert.equal(f.rows().length, 2);
  assert.deepEqual(f.rows().map(row => nodes(row).find(node => node.type === "td").props.children), [63, 74]);
  f.errorsOnly(false);
  assert.equal(f.rows().length, 25);
  for (const invalid of ["0", "5", "NaN", "2.5"]) {
    f.page(invalid);
    assert.equal(f.find(node => node.type === "select").props.value, 1);
  }
});

test("una página y la importación en curso deshabilitan los controles correctos", () => {
  const one = tableFixture(preview("SERVICE", 5, []));
  assert.equal(one.rows().length, 5);
  assert.equal(one.find(node => node.type === "input"), undefined);
  for (const text of ["Anterior", "Siguiente"]) assert.equal(one.button(text).props.disabled, true);
  assert.equal(one.find(node => node.type === "select").props.disabled, true);
  const busy = tableFixture(preview(), true);
  for (const node of nodes(busy.find(node => node.type === "div")).filter(node => ["input", "select", "Button"].includes(node.type))) {
    assert.equal(node.props.disabled, true);
  }
});

test("cambiar archivo, validar de nuevo y cerrar desmontan la paginación anterior; navegar no importa datos", async () => {
  const h = hooks();
  let task;
  let previewCalls = 0;
  let importCalls = 0;
  const { ImportPriceCatalogDialog } = load(dialog, {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: h.useState, useRef: () => ({ current: null }), useTransition: () => [false, callback => { task = callback(); }] },
    "lucide-react": {}, "next/navigation": { useRouter: () => ({}) },
    "@/components/ui/button": { Button: "Button" },
    "@/components/feedback/loading-button": { LoadingButton: "LoadingButton" },
    "@/components/ui/dialog": { Dialog: "Dialog", DialogFooter: "DialogFooter" },
    "../navigation": {}, "./price-catalog-preview-table": { PriceCatalogPreviewTable: "PreviewTable" },
    "../actions": {
      async previewProjectPriceCatalogAction() { previewCalls++; return { status: "success", ...preview() }; },
      async importProjectPriceCatalogAction() { importCalls++; },
    },
  });
  let tree;
  const render = () => { h.reset(); tree = ImportPriceCatalogDialog({ companyId: "company", projectId: "project", catalogKind: "PRODUCT" }); };
  const find = predicate => nodes(tree).find(predicate);
  const validate = () => find(node => node.props?.children === "Validar y generar vista previa").props.onClick();
  const selectFile = name => { find(node => node.type === "input" && node.props.type === "file").props.onChange({ target: { files: [new File(["file"], name)] } }); render(); };
  render();
  find(node => node.type === "Button").props.onClick(); render();
  selectFile("primero.xlsx"); validate(); await task; render();
  assert.ok(find(node => node.type === "PreviewTable"));
  const firstKey = find(node => node.type === "PreviewTable").key;
  validate(); render();
  assert.equal(find(node => node.type === "PreviewTable"), undefined);
  await task; render();
  assert.ok(find(node => node.type === "PreviewTable"));
  assert.notEqual(find(node => node.type === "PreviewTable").key, firstKey);
  selectFile("segundo.xlsx");
  assert.equal(find(node => node.type === "PreviewTable"), undefined);
  assert.equal(find(node => node.props?.children === "Confirmar importación").props.disabled, true);
  find(node => node.type === "Dialog").props.onClose(); render();
  find(node => node.type === "Button").props.onClick(); render();
  assert.equal(find(node => node.type === "PreviewTable"), undefined);
  assert.equal(previewCalls, 2);
  assert.equal(importCalls, 0);
});
