import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hasUniversalOperationalViewRole,
  PLATFORM_ADMIN_VIEW_SOURCE_ROLES,
  selectOperationalViewPermissions,
} from "../src/features/projects/access-policy.ts";

test("PLATFORM_ADMIN hereda las vistas de Compras, Recepción y Residentes", () => {
  assert.deepEqual(PLATFORM_ADMIN_VIEW_SOURCE_ROLES, [
    "PURCHASING",
    "RECEPTION",
    "RESIDENT",
  ]);
  assert.deepEqual(
    selectOperationalViewPermissions([
      "programming.view",
      "programming.create",
      "dispatch.view",
      "dispatch.modify",
      "batch.view",
      "invoice.view",
      "invoice.create",
      "document.view",
      "programming.view",
    ]),
    [
      "batch.view",
      "dispatch.view",
      "document.view",
      "invoice.view",
      "programming.view",
    ],
  );
});

test("PLATFORM_ADMIN participa en vistas universales de solo lectura", () => {
  assert.equal(hasUniversalOperationalViewRole(["PLATFORM_ADMIN"]), true);
  assert.equal(hasUniversalOperationalViewRole(["PURCHASING"]), true);
  assert.equal(hasUniversalOperationalViewRole(["COMPANY_ADMIN"]), true);
  assert.equal(hasUniversalOperationalViewRole(["RECEPTION"]), false);
});

test("el alcance global se resuelve en servidor sin conceder escrituras", async () => {
  const [queries, actions, batches, reports, userDetail, dashboard] = await Promise.all(
    [
      "../src/features/projects/queries.ts",
      "../src/features/projects/actions.ts",
      "../src/features/batches/queries.ts",
      "../src/features/reports/queries.ts",
      "../src/features/platform/users/components/user-detail-view.tsx",
      "../src/features/dashboard/components/project-dashboard.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(queries, /isPlatformAdmin\(userId\)/u);
  assert.match(queries, /\.from\("projects"\)\.select\(PROJECT_COLUMNS\)/u);
  assert.match(queries, /roleCodes: \["PLATFORM_ADMIN"\]/u);
  assert.match(queries, /selectOperationalViewPermissions/u);
  assert.deepEqual(
    selectOperationalViewPermissions([
      "programming.create",
      "dispatch.modify",
      "batch.modify",
      "invoice.create",
    ]),
    [],
  );
  assert.match(actions, /canAccessOperationalProject/u);
  assert.match(actions, /global read scope/u);
  assert.match(batches, /hasUniversalOperationalViewRole/u);
  assert.match(reports, /hasUniversalOperationalViewRole/u);
  assert.match(userDetail, /Las acciones de escritura continúan requiriendo/u);
  assert.match(dashboard, /"COMPANY_ADMIN", "PLATFORM_ADMIN"/u);
});
