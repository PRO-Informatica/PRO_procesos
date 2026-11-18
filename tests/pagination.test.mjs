import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { paginationModel, paginationHref, parsePaginationTarget } from "../src/components/ui/pagination-model.ts";

const jsx = (type, props, key) => ({ type, props, key });
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
function fixture(props) {
  const changed = [], pushed = [];
  let value = { value: "", error: "" };
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: () => [value, next => { value = next; }] },
    "lucide-react": { ChevronLeft: "ChevronLeft", ChevronRight: "ChevronRight" },
    "next/link": { __esModule: true, default: "Link" },
    "next/navigation": { useRouter: () => ({ push: (...args) => pushed.push(args) }) },
    "./pagination-model": { paginationModel, paginationHref, parsePaginationTarget },
    "./pagination.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL("../src/components/ui/pagination.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { exports, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const tree = exports.Pagination({ page: 15, pageSize: 10, total: 1096, onPageChange: page => changed.push(page), ...props });
  const jump = nodes(tree).find(node => typeof node.type === "function");
  return { tree, changed, pushed,
    control: label => nodes(tree).find(node => node.props?.["aria-label"] === label),
    input: () => nodes(jump.type(jump.props)).find(node => node.type === "input"),
    error: () => nodes(jump.type(jump.props)).find(node => node.props?.role === "alert"),
  };
}

test("ventana de cinco páginas centrada y ajustada en ambos extremos, con rangos parciales y vacíos", () => {
  assert.deepEqual(paginationModel(15, 10, 1096), { currentPage: 15, pageCount: 110, firstItem: 141, lastItem: 150, pages: [13, 14, 15, 16, 17] });
  assert.deepEqual(paginationModel(1, 10, 1096).pages, [1, 2, 3, 4, 5]);
  assert.deepEqual(paginationModel(110, 10, 1096).pages, [106, 107, 108, 109, 110]);
  assert.equal(paginationModel(999, 10, 1096).firstItem, 1091);
  assert.equal(paginationModel(999, 10, 1096).lastItem, 1096);
  assert.deepEqual(paginationModel(0, 10, 0), { currentPage: 1, pageCount: 1, firstItem: 0, lastItem: 0, pages: [1] });
});

test("los enlaces conservan filtros, anclas y las páginas independientes de productos y servicios", () => {
  const href = "/catalogs?project=acoat&productPage=3&servicePage=2&search=CON%2B4001#services";
  const url = new URL(paginationHref(href, 4, "servicePage"), "http://localhost");
  assert.equal(url.searchParams.get("servicePage"), "4");
  assert.equal(url.searchParams.get("productPage"), "3");
  assert.equal(url.searchParams.get("search"), "CON+4001");
  assert.equal(url.searchParams.get("project"), "acoat");
  assert.equal(url.hash, "#services");
  assert.equal(new URL(paginationHref(href, 1, "servicePage"), url).searchParams.has("servicePage"), false);
  assert.equal(paginationHref("?page=2", 1), "?");
  assert.equal(paginationHref("/users", 3), "/users?page=3");
});

test("el salto solo acepta páginas enteras dentro del rango", () => {
  for (const invalid of ["", "0", "111", "NaN", "2.5", "1e2", "-1", "2x"]) assert.equal(parsePaginationTarget(invalid, 110), null, invalid);
  assert.equal(parsePaginationTarget(" 102 ", 110), 102);
});

test("flechas, números y página activa navegan por callback y exponen etiquetas accesibles", () => {
  const f = fixture({});
  assert.equal(f.tree.type, "nav");
  assert.equal(text(nodes(f.tree).find(node => node.props?.role === "status")), "Mostrando 141–150 de 1096 registros");
  assert.equal(f.control("Ir a la página 15").props["aria-current"], "page");
  assert.match(f.control("Ir a la página 15").props.className, /active/);
  f.control("Ver página anterior").props.onClick();
  f.control("Ver página siguiente").props.onClick();
  f.control("Ir a la página 17").props.onClick();
  f.control("Ir a la página 15").props.onClick();
  assert.deepEqual(f.changed, [14, 16, 17]);
  for (const [page, label] of [[1, "Ver página anterior"], [110, "Ver página siguiente"]]) assert.equal(fixture({ page }).control(label).props.disabled, true);
});

test("Enter realiza el salto sin enviar el formulario padre y rechaza páginas inexistentes", () => {
  const f = fixture({});
  let prevented = 0;
  const element = { setCustomValidity() { throw Error("No debe bloquear la validación del formulario padre"); } };
  f.input().props.onChange({ target: { value: "102" }, currentTarget: element });
  f.input().props.onKeyDown({ key: "Enter", preventDefault: () => prevented++, currentTarget: element });
  assert.deepEqual(f.changed, [102]);
  f.input().props.onChange({ target: { value: "111" }, currentTarget: element });
  f.input().props.onKeyDown({ key: "Enter", preventDefault: () => prevented++, currentTarget: element });
  assert.deepEqual(f.changed, [102]);
  assert.equal(prevented, 2);
  assert.match(text(f.error()), /entre 1 y 110/);
  assert.equal(f.input().props["aria-invalid"], true);
  f.input().props.onChange({ target: { value: "2" }, currentTarget: element });
  assert.equal(f.error(), undefined);
});

test("modo de enlaces conserva filtros también al saltar; importación bloquea todos los controles", () => {
  const linked = fixture({ href: "/users?query=Ana&status=active&page=15", onPageChange: undefined });
  assert.equal(linked.control("Ir a la página 17").type, "Link");
  assert.equal(linked.control("Ir a la página 17").props.href, "/users?query=Ana&status=active&page=17");
  const element = { setCustomValidity() {} };
  linked.input().props.onChange({ target: { value: "3" }, currentTarget: element });
  linked.input().props.onKeyDown({ key: "Enter", preventDefault() {}, currentTarget: element });
  assert.equal(linked.pushed[0][0], "/users?query=Ana&status=active&page=3");
  assert.equal(linked.pushed[0][1].scroll, false);
  const busy = fixture({ disabled: true });
  assert.ok(nodes(busy.tree).filter(node => node.type === "button").every(node => node.props.disabled));
  assert.equal(busy.input().props.disabled, true);
  busy.control("Ir a la página 17").props.onClick();
  assert.deepEqual(busy.changed, []);
  assert.equal(fixture({ total: 5, page: 1 }).input().props.disabled, true);
});
