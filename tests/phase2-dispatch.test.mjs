import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canCompleteDispatch,
  realVolumeWarning,
  totalGuideVolume,
} from "../src/features/dispatches/validation.ts";

const migration = await readFile(
  new URL("../supabase/migrations/080_phase2_dispatch_architecture.sql", import.meta.url),
  "utf8",
);
const multipleGuidesMigration = await readFile(
  new URL("../supabase/migrations/081_allow_multiple_guides_per_dispatch.sql", import.meta.url),
  "utf8",
);
const completionValidationMigration = await readFile(
  new URL("../supabase/migrations/082_dispatch_operation_day_and_evidence.sql", import.meta.url),
  "utf8",
);

test("calcula N guías sin límite fijo", () => {
  assert.equal(totalGuideVolume([{ quantity: 7 }, { quantity: 8 }, { quantity: 2.5 }]), 17.5);
});

test("una diferencia de Volumen Real advierte pero no invalida", () => {
  assert.equal(realVolumeWarning(15, 14.5)?.startsWith("El Volumen Real"), true);
  assert.equal(realVolumeWarning(15, 15), null);
});

test("Despachado requiere guía, tiempos, pedido, Volumen Real y UM", () => {
  assert.equal(canCompleteDispatch({
    result: "DISPATCHED", guideCount: 1, incidentCount: 0, evidenceCount: 1,
    arrivalAt: "2026-09-03T12:00:00Z", departureAt: "2026-09-03T13:00:00Z",
    orderNumber: "PCA-20", realVolume: 7, realUnitCode: "M3",
  }), true);
  assert.equal(canCompleteDispatch({
    result: "DISPATCHED", guideCount: 0, incidentCount: 0, evidenceCount: 1,
    arrivalAt: "2026-09-03T12:00:00Z", departureAt: "2026-09-03T13:00:00Z",
    orderNumber: "PCA-20", realVolume: 7, realUnitCode: "M3",
  }), false);
});

test("No despachado requiere incidencia y Volumen Real cero", () => {
  const base = {
    result: "NOT_DISPATCHED",
    guideCount: 0,
    evidenceCount: 1,
    arrivalAt: "2026-09-03T12:00:00Z",
    departureAt: null,
    orderNumber: null,
    realUnitCode: "M3",
  };
  assert.equal(canCompleteDispatch({ ...base, incidentCount: 1, realVolume: 0 }), true);
  assert.equal(canCompleteDispatch({ ...base, incidentCount: 0, realVolume: 0 }), false);
  assert.equal(canCompleteDispatch({ ...base, incidentCount: 1, realVolume: 1 }), false);
});

test("la migración protege cardinalidad, estados e inmutabilidad", () => {
  assert.match(migration, /dispatches_programming_uq unique \(programming_id\)/u);
  assert.match(migration, /enum \('IN_EXECUTION', 'COMPLETED'\)/u);
  assert.match(migration, /enum \('DISPATCHED', 'NOT_DISPATCHED'\)/u);
  assert.match(migration, /NOT_DISPATCHED_INCIDENT_REQUIRED/u);
  assert.match(migration, /DISPATCH_COMPLETED_NOT_EDITABLE/u);
  assert.doesNotMatch(migration, /flow_version/u);
});

test("Lotes no cambian dispatches.status", () => {
  const batchSection = migration.slice(migration.indexOf("8. BATCH INTEGRATION"));
  assert.doesNotMatch(batchSection, /update public\.dispatches\s+set status/iu);
});

test("un despacho admite N guías y conserva números únicos dentro del despacho", () => {
  assert.match(
    multipleGuidesMigration,
    /drop constraint if exists dispatch_guides_dispatch_uq/iu,
  );
  assert.match(
    multipleGuidesMigration,
    /UNIQUE \(dispatch_id, guide_number\)/u,
  );
});

test("finalizar exige evidencia y horas del día de la programación", () => {
  assert.equal(canCompleteDispatch({
    result: "DISPATCHED",
    guideCount: 1,
    incidentCount: 0,
    evidenceCount: 0,
    arrivalAt: "2026-09-04T12:00:00Z",
    departureAt: "2026-09-04T13:00:00Z",
    orderNumber: "PCA-20",
    realVolume: 7,
    realUnitCode: "M3",
  }), false);
  assert.match(completionValidationMigration, /DISPATCH_ARRIVAL_DATE_MISMATCH/u);
  assert.match(completionValidationMigration, /DISPATCH_DEPARTURE_DATE_MISMATCH/u);
  assert.match(completionValidationMigration, /DISPATCH_EVIDENCE_REQUIRED/u);
  assert.match(completionValidationMigration, /public\.finalize_dispatch/u);
});
