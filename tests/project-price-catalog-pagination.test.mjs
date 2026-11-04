import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { catalogHrefAfterImport } from "../src/features/platform/project-price-catalogs/navigation.ts";

const source = await readFile(new URL("../src/features/platform/project-price-catalogs/queries.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function catalogQueries({ services = 20, products = 24, rowsError = null, latestError = null } = {}) {
  const calls = [];
  const makeRows = (total, project = "project-a") => Array.from({ length: total }, (_, i) => ({
    id: `${project}-${i}`, project_id: project, code: `C${String(i).padStart(3, "0")}`,
    reference: "CON.3003", description: "Bomba", observations: "Tarifa especial", unit_code: "M3", price: 80.64,
    updated_at: "2026-10-23T07:00:00Z",
  }));
  const tables = {
    projects: [{ id: "project-a", company_id: "company-a", name: "Proyecto", code: "P" }],
    companies: [{ id: "company-a", name: "Empresa" }],
    project_product_prices: [...makeRows(products), ...makeRows(30, "other-project")],
    project_service_prices: [...makeRows(services), ...makeRows(30, "other-project")],
  };
  const supabase = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      const filters = [];
      const order = [];
      let range = null;
      let single = false;
      let search = "";
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order(key) { order.push(key); return query; },
        range(from, to) { range = [from, to]; return query; },
        or(value) { search = value; return query; },
        limit() { return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          calls.push({ table, filters, range, search, order });
          const rows = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
          const forcedError = table === "project_service_prices" ? (range ? rowsError : latestError) : null;
          let result;
          if (forcedError) result = { data: null, count: null, error: { code: forcedError } };
          // Match the real SDK: invalid offsets return an error and NO count.
          else if (range && range[0] > 0 && range[0] >= rows.length) result = { data: null, count: null, error: { code: "PGRST103" } };
          else result = { data: single ? rows[0] ?? null : range ? rows.slice(range[0], range[1] + 1) : rows, count: rows.length, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(path) {
      if (path === "server-only") return {};
      assert.equal(path, "@/lib/supabase/server");
      return { createClient: async () => supabase };
    },
  });
  return { get: exports.getProjectPriceCatalogs, calls };
}

const filters = { productQuery: "", productPage: 1, serviceQuery: "", servicePage: 2 };

test("recupera página 1 cuando REPLACE deja 20 servicios y la URL sigue en página 2", async () => {
  const { get, calls } = catalogQueries();
  const result = await get("company-a", "project-a", filters);
  assert.equal(result.services.total, 20);
  assert.equal(result.services.items.length, 20);
  assert.equal(result.services.page, 1);
  assert.equal(result.services.totalPages, 1);
  assert.deepEqual(calls.filter(call => call.table === "project_service_prices" && call.range).map(call => call.range), [[25, 49], [0, 24]]);
  assert.ok(calls.filter(call => call.table.startsWith("project_")).every(call => call.filters.some(([key, value]) => key === "project_id" && value === "project-a")));
});

test("productos tienen la misma recuperación sin perder búsqueda ni alcance", async () => {
  const { get, calls } = catalogQueries();
  const result = await get("company-a", "project-a", { ...filters, productPage: 2, productQuery: "CON.3003", servicePage: 1 });
  assert.equal(result.products.page, 1);
  assert.equal(result.products.total, 24);
  const productCalls = calls.filter(call => call.table === "project_product_prices" && call.range);
  assert.equal(productCalls.length, 2);
  assert.ok(productCalls.every(call => call.search.includes("CON.3003")));
});

test("una página 2 válida sigue mostrando sus registros", async () => {
  const { get } = catalogQueries({ services: 28 });
  const result = await get("company-a", "project-a", filters);
  assert.equal(result.services.page, 2);
  assert.equal(result.services.totalPages, 2);
  assert.equal(result.services.items.length, 3);
});

test("servicios ordenan variantes por observaciones e ID, sin cambiar productos, y permiten buscar observaciones", async () => {
  const { get, calls } = catalogQueries({ services: 28 });
  const result = await get("company-a", "project-a", { ...filters, serviceQuery: "Tarifa" });
  assert.deepEqual(calls.find(call => call.table === "project_service_prices" && call.range).order, ["code", "observations", "id"]);
  assert.ok(calls.find(call => call.table === "project_service_prices" && call.range).search.includes("observations.ilike.%Tarifa%"));
  assert.equal(result.services.items[0].observations, "Tarifa especial");
  assert.deepEqual(calls.find(call => call.table === "project_product_prices" && call.range).order, ["code", "reference"]);
});

test("un catálogo vacío con página obsoleta devuelve el estado vacío sin bucles", async () => {
  const { get, calls } = catalogQueries({ services: 0 });
  const result = await get("company-a", "project-a", filters);
  assert.equal(result.services.total, 0);
  assert.equal(result.services.page, 1);
  assert.equal(result.services.items.length, 0);
  assert.equal(calls.filter(call => call.table === "project_service_prices" && call.range).length, 2);
});

for (const code of ["42501", "42703", "PGRST204"]) {
  test(`no oculta errores reales ${code} como si fueran de paginación`, async () => {
    const { get, calls } = catalogQueries({ rowsError: code });
    await assert.rejects(() => get("company-a", "project-a", filters), error => error.cause.code === code);
    assert.equal(calls.filter(call => call.table === "project_service_prices" && call.range).length, 1);
  });
}

test("un PGRST103 en página 1 o un fallo de última actualización no se reintenta", async () => {
  const first = catalogQueries({ rowsError: "PGRST103" });
  await assert.rejects(() => first.get("company-a", "project-a", { ...filters, servicePage: 1 }), /catálogo de servicios/u);
  assert.equal(first.calls.filter(call => call.table === "project_service_prices" && call.range).length, 1);
  const latest = catalogQueries({ latestError: "42501" });
  await assert.rejects(() => latest.get("company-a", "project-a", filters), /catálogo de servicios/u);
  assert.equal(latest.calls.filter(call => call.table === "project_service_prices" && call.range).length, 1);
});

test("importar servicios reinicia solo su página y conserva filtros y catálogo de productos", () => {
  const href = catalogHrefAfterImport("http://localhost:3000/catalogs?productPage=3&servicePage=2&productQuery=CON.3003&serviceQuery=Bomba#servicios", "SERVICE");
  const url = new URL(href, "http://localhost:3000");
  assert.equal(url.searchParams.has("servicePage"), false);
  assert.equal(url.searchParams.get("productPage"), "3");
  assert.equal(url.searchParams.get("productQuery"), "CON.3003");
  assert.equal(url.searchParams.get("serviceQuery"), "Bomba");
  assert.equal(url.hash, "#servicios");
});

test("importar productos reinicia solo su página", () => {
  assert.equal(catalogHrefAfterImport("https://example.test/catalogs?productPage=3&servicePage=2", "PRODUCT"), "/catalogs?servicePage=2");
  assert.equal(catalogHrefAfterImport("https://example.test/catalogs", "SERVICE"), "/catalogs");
});
