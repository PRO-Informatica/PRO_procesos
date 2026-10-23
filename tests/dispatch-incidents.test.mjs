import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { normalizeCatalogReference } from "../src/features/dispatches/catalog-estimates.ts";

const source = await readFile(
  new URL("../src/features/dispatches/queries.ts", import.meta.url), "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function detailQuery({ missingProject = false } = {}) {
  const queries = [];
  const tables = {
    projects: missingProject ? [] : [{ id: "project-a", company_id: "company-a" }],
    dispatches: [{ id: "dispatch-a", project_id: "project-a", programming_id: "programming-a", supplier_id: "supplier-a", created_by: "actor", status: "IN_EXECUTION", real_volume: null }],
    programming: [{ id: "programming-a", project_id: "project-a", scheduled_at: "2026-10-31T19:00:00Z", requested_quantity: 45, confirmed_quantity: null, unit_code: "M3" }],
    suppliers: [{ id: "supplier-a", name: "Proveedor" }],
    dispatch_guides: [],
    dispatch_incidents: [{ id: "incident-a", project_id: "project-a", dispatch_id: "dispatch-a", incident_type_id: "type-inactive", reported_by: "actor" }],
    units_of_measure: [],
    incident_types: [
      { id: "type-a", company_id: "company-a", name: "Demora", active: true },
      { id: "type-b", company_id: "company-b", name: "Demora", active: true },
      { id: "type-inactive", company_id: "company-a", name: "Histórica", active: false },
    ],
    programming_lines: [], dispatch_documents: [], incident_documents: [],
    batch_dispatches: [], dispatch_reconciliations: [], invoices: [],
    profiles: [{ id: "actor", full_name: "Residente" }],
  };
  const supabase = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      const filters = [];
      let single = false;
      const result = () => {
        queries.push({ table, filters });
        const rows = tables[table].filter(row => filters.every(([key, values]) => values.includes(row[key])));
        return { data: single ? rows[0] ?? null : rows, error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, [value]]); return query; },
        in(key, values) { filters.push([key, values]); return query; },
        order() { return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
  };
  const imports = {
    "server-only": {},
    "@/lib/supabase/admin": { createAdminClient: () => supabase },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "./formatters": {
      formatIdentifier: (prefix, id) => `${prefix}-${id}`,
      normalizeCatalogReference,
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(path) {
      assert.ok(Object.hasOwn(imports, path), `Unexpected import: ${path}`);
      return imports[path];
    },
  });
  return { getDispatchDetail: exports.getDispatchDetail, queries };
}

test("el selector solo ofrece tipos activos de la empresa del despacho, aunque existan nombres iguales", async () => {
  const { getDispatchDetail, queries } = detailQuery();
  const detail = await getDispatchDetail("project-a", "dispatch-a");
  assert.equal(detail.incidentTypes.length, 1);
  assert.equal(detail.incidentTypes[0].id, "type-a");
  for (const query of queries.filter(query => query.table === "incident_types")) {
    assert.ok(query.filters.some(([key, values]) => key === "company_id" && values[0] === "company-a"));
  }
});

test("los tipos desactivados conservan su nombre en incidencias históricas de la misma empresa", async () => {
  const { getDispatchDetail } = detailQuery();
  const detail = await getDispatchDetail("project-a", "dispatch-a");
  assert.equal(detail.incidents[0].typeName, "Histórica");
  assert.equal(detail.incidentTypes.some(type => type.id === "type-inactive"), false);
});

test("si el proyecto no es accesible, no se carga un catálogo global como respaldo", async () => {
  const { getDispatchDetail, queries } = detailQuery({ missingProject: true });
  assert.equal(await getDispatchDetail("project-a", "dispatch-a"), null);
  assert.equal(queries.some(query => query.table === "incident_types"), false);
});
