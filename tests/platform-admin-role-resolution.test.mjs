import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as policy from "../src/features/projects/access-policy.ts";
import * as types from "../src/features/projects/types.ts";

const compiled = ts.transpileModule(await readFile(new URL("../src/features/projects/queries.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ supervisor = "SUPERVISOR", both = false, missing = false, admin = true, roleError = null, memberRoles = [], inherited = [] } = {}) {
  const calls = [], diagnostics = [], exports = {};
  const roles = [{ id: "purchasing", code: "PURCHASING", active: true },
    ...(!missing ? [{ id: "resident", code: "RESIDENT", active: true }] : []),
    { id: "supervisor", code: supervisor, active: true },
    ...(both ? [{ id: "legacy", code: "RECEPTION", active: true }] : [])];
  const data = {
    roles,
    role_permissions: roles.flatMap(role => [{ role_id: role.id, permission_id: "read" }, { role_id: role.id, permission_id: "write" }]),
    permissions: [{ id: "read", code: "dispatch.view", active: true }, { id: "write", code: "dispatch.complete", active: true }],
    projects: [{ id: "project", company_id: "company", name: "Proyecto", code: "PROJECT", address: "Dirección", additional_addresses: [], status: "ACTIVE", timezone: "America/Guatemala" }],
    companies: [{ id: "company", code: "COMPANY", name: "Empresa" }],
    project_members: memberRoles.length ? [{ id: "member", project_id: "project", user_id: "user", active: true }] : [], company_members: [],
    project_member_roles: memberRoles.map(role => ({ project_member_id: "member", role_id: role, revoked_at: null })),
  };
  for (const code of inherited) {
    data.permissions.push({ id: code, code, active: true });
    data.role_permissions.push({ role_id: "supervisor", permission_id: code });
  }
  const api = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    let rows = data[table]; assert.ok(rows, table);
    const query = {
      select() { return query; },
      eq(column, value) { rows = rows.filter(row => row[column] === value); return query; },
      in(column, values) { call.filters.push({ column, values }); rows = rows.filter(row => values.includes(row[column])); return query; },
      is(column, value) { rows = rows.filter(row => row[column] === value); return query; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: table === "roles" && roleError ? null : rows, error: table === "roles" ? roleError : null }).then(resolve, reject); },
    };
    return query;
  } };
  const imports = {
    "server-only": {}, "next/headers": { cookies: async () => ({ get: () => ({ value: "project" }) }) },
    "@/features/platform/queries": { isPlatformAdmin: async () => admin },
    "@/lib/supabase/server": { createClient: async () => api },
    "./access-policy": policy, "./types": types,
  };
  runInNewContext(compiled, { exports, console: { error: (...args) => diagnostics.push(args) }, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { queries: exports, calls, diagnostics };
}

for (const supervisor of ["SUPERVISOR", "RECEPTION"]) {
  test(`plataforma puede abrir el despacho con el rol ${supervisor}, sin heredar finalización`, async () => {
    const f = fixture({ supervisor });
    const context = await f.queries.getProjectContext("admin");
    assert.equal(context.status, "ready");
    assert.equal(context.activeProject.id, "project");
    assert.deepEqual([...context.permissions], ["dispatch.view"]);
    assert.deepEqual([...context.roleCodes], ["PLATFORM_ADMIN"]);
    assert.equal(context.isCompanyAdmin, false);
    assert.equal(f.diagnostics.length, 0);
  });
}

test("si ambos nombres están presentes usa Supervisor y no duplica el rol anterior", async () => {
  const f = fixture({ both: true });
  assert.equal((await f.queries.getProjectContext("admin")).status, "ready");
  const ids = f.calls.find(call => call.table === "role_permissions").filters[0].values;
  assert.ok(ids.includes("supervisor"));
  assert.ok(!ids.includes("legacy"));
  assert.equal(ids.length, 3);
});

test("una configuración incompleta o un rechazo de consulta no concede acceso parcial", async () => {
  for (const settings of [{ missing: true }, { roleError: { code: "42501", message: "permission denied" } }]) {
    const f = fixture(settings);
    const context = await f.queries.getProjectContext("admin");
    assert.equal(context.status, "error");
    assert.equal(context.activeProject, null);
    assert.match(context.message, /resolver las vistas operativas/u);
    assert.equal(f.diagnostics.length, 1);
    assert.equal(f.calls.some(call => call.table === "role_permissions"), false);
  }
});

test("sin administración no consulta ni hereda los roles de las vistas globales", async () => {
  const f = fixture({ admin: false });
  assert.equal((await f.queries.getProjectContext("user")).status, "empty");
  assert.equal(f.calls.some(call => call.table === "roles"), false);
});

for (const supervisor of ["SUPERVISOR", "RECEPTION"]) {
  test(`resolver central restringe ${supervisor} aunque la base conserve permisos heredados`, async () => {
    const inherited = ["batch.view", "invoice.view", "report.view", "programming.view", "programming.create", "programming.modify", "dispatch.create", "dispatch.modify", "dispatch.register_incident", "gmail.mailbox.view", "gmail.mail.send"];
    const f = fixture({ admin: false, supervisor, memberRoles: ["supervisor"], inherited });
    for (const scope of [await f.queries.getProjectContext("user"), await f.queries.getOperationalProjectAccessForProject("user", "project")]) {
      assert.ok(scope); assert.deepEqual([...scope.roleCodes], [supervisor]);
      assert.deepEqual([...scope.permissions].sort(), ["dispatch.view", "dispatch.create", "dispatch.manage_guides", "programming.view"].sort());
    }
  });
}
