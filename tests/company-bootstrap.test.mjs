import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/088_fix_company_bootstrap_after_phase2.sql",
    import.meta.url,
  ),
  "utf8",
);
const qa = await readFile(
  new URL("../supabase/qa/company_bootstrap_20260904.sql", import.meta.url),
  "utf8",
);
const companyActions = await readFile(
  new URL("../src/features/platform/companies/actions.ts", import.meta.url),
  "utf8",
);

const replacementStart = migration.indexOf(
  "create or replace function public.bootstrap_company_defaults",
);
const replacementEnd = migration.indexOf(
  "alter function public.bootstrap_company_defaults",
);
const replacement = migration.slice(replacementStart, replacementEnd);

test("el bootstrap conserva únicamente los defaults vigentes", () => {
  assert.ok(replacementStart >= 0);
  assert.match(replacement, /insert into public\.suppliers/u);
  assert.match(replacement, /'MIXTO_LISTO'/u);
  assert.match(replacement, /insert into public\.incident_types/u);
  assert.doesNotMatch(replacement, /supplier_templates/u);
  assert.doesNotMatch(replacement, /supplier_template_versions/u);
  assert.doesNotMatch(replacement, /supplier_template_fields/u);
});

test("la migración rechaza referencias activas a las tablas legacy", () => {
  assert.match(migration, /pg_catalog\.pg_proc/u);
  assert.match(migration, /procedure\.prokind in \('f', 'p'\)/u);
  assert.match(migration, /COMPANY_BOOTSTRAP_LEGACY_ROUTINES_REMAIN/u);
});

test("el QA ejecuta el trigger real y revierte todos los datos de prueba", () => {
  assert.match(qa, /insert into public\.companies/u);
  assert.match(qa, /supplier\.code = 'MIXTO_LISTO'/u);
  assert.match(qa, /\) <> 9 then/u);
  assert.match(qa, /COMPANY_BOOTSTRAP_QA_LEGACY_ROUTINES_REMAIN/u);
  assert.match(qa, /rollback;/u);
});

test("la creación registra el error técnico sin exponerlo al usuario", () => {
  const createCompanySection = companyActions.slice(
    companyActions.indexOf("export async function createCompany("),
  );
  assert.match(createCompanySection, /console\.error\(/u);
  assert.match(
    companyActions,
    /No fue posible completar la operación\. Intenta nuevamente\./u,
  );
});
