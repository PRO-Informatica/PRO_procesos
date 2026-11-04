import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as addressInput from "../src/features/platform/companies/project-address-input.ts";

const code = ts.transpileModule(await readFile(new URL("../src/features/platform/companies/actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const companyId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";

function fixture({ admin = true, databaseError = null } = {}) {
  const calls = [], refreshed = [], exports = {};
  const api = { auth: { getClaims: async () => ({ data: { claims: { sub: "user" } } }) },
    rpc: async (name, params) => { calls.push({ name, params }); return { data: projectId, error: databaseError }; } };
  const imports = {
    "next/cache": { revalidatePath: (path) => refreshed.push(path) },
    "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
    "@/features/platform/queries": { isPlatformAdmin: async () => admin },
    "@/lib/supabase/server": { createClient: async () => api },
    "./project-address-input": addressInput,
  };
  runInNewContext(code, { exports, Intl, require: (name) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  const form = new FormData();
  for (const [key, value] of Object.entries({ companyId, projectId, name: "QA project", code: "QA-PROJECT", address: "CALLE 1 ZONA 1 GUATEMALA", timezone: "America/Guatemala", status: "ACTIVE", billingLegalName: "QA legal entity", billingTaxId: "1234567" })) form.set(key, value);
  form.append("additionalAddress", "CALLE 2 ZONA 2 GUATEMALA");
  form.append("additionalAddress", "CALLE 3 ZONA 3 GUATEMALA");
  return { actions: exports, form, calls, refreshed };
}

test("edición guarda direcciones y datos fiscales mediante una única operación atómica", async () => {
  const f = fixture();
  const result = await f.actions.updateCompanyProject({ status: "idle" }, f.form);
  assert.equal(result.status, "success");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "platform_save_company_project");
  assert.deepEqual([...f.calls[0].params.p_additional_addresses], ["CALLE 2 ZONA 2 GUATEMALA", "CALLE 3 ZONA 3 GUATEMALA"]);
  assert.equal(f.calls[0].params.p_project_id, projectId);
  assert.equal(f.calls[0].params.p_billing_legal_name, "QA legal entity");
  assert.ok(f.refreshed.includes("/programming") && f.refreshed.includes("/invoices/universal"));
});

test("creación también guarda todas las direcciones antes de redirigir", async () => {
  const f = fixture();
  await assert.rejects(() => f.actions.createCompanyProject({ status: "idle" }, f.form), /REDIRECT/u);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].params.p_project_id, null);
  assert.equal(f.calls[0].params.p_additional_addresses.length, 2);
});

test("rechaza duplicados o filas vacías antes de consultar la base", async () => {
  for (const value of ["", "calle 1, zona 1 guatemala"]) {
    const f = fixture(); f.form.set("additionalAddress", value);
    const result = await f.actions.updateCompanyProject({ status: "idle" }, f.form);
    assert.equal(result.status, "error");
    assert.equal(f.calls.length, 0);
    assert.deepEqual([...result.fields.additionalAddresses], [value]);
  }
});

test("un usuario sin administración no puede guardar direcciones", async () => {
  const f = fixture({ admin: false });
  assert.equal((await f.actions.updateCompanyProject({ status: "idle" }, f.form)).status, "error");
  assert.equal(f.calls.length, 0);
});

test("un rechazo de la base conserva cada dirección del formulario", async () => {
  const f = fixture({ databaseError: { message: "PROJECT_ADDRESSES_INVALID" } });
  const result = await f.actions.updateCompanyProject({ status: "idle" }, f.form);
  assert.equal(result.status, "error");
  assert.equal(result.fields.additionalAddresses.length, 2);
  assert.equal(f.refreshed.length, 0);
});
