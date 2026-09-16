import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/102_restore_rbac_catalog.sql", import.meta.url),
  "utf8",
);

test("la restauración RBAC es transaccional, aditiva y valida el catálogo", () => {
  assert.match(migration, /^begin;/mu);
  assert.match(migration, /on conflict \(code\) do nothing/u);
  assert.match(migration, /on conflict do nothing/u);
  assert.match(migration, /CANONICAL_PERMISSION_COUNT_INVALID/u);
  assert.match(migration, /CANONICAL_ROLE_PERMISSION_COUNT_INVALID/u);
  assert.match(migration, /CANONICAL_ROLE_PERMISSION_ASSIGNMENT_MISSING/u);
  assert.match(migration, /commit;\s*$/u);
  assert.doesNotMatch(migration, /\b(delete|truncate|drop table|update)\b/iu);
});

test("el catálogo incluye las vistas canónicas de los tres roles operativos", () => {
  for (const permission of [
    "programming.view",
    "dispatch.view",
    "batch.view",
    "invoice.view",
    "document.view",
    "project.view",
  ]) {
    assert.match(migration, new RegExp(`\\('${permission.replace(".", "\\.")}'`, "u"));
  }

  for (const role of ["PURCHASING", "RECEPTION", "RESIDENT"]) {
    assert.match(migration, new RegExp(`\\('${role}',`, "u"));
  }
});
