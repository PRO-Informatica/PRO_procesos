import assert from "node:assert/strict";
import test from "node:test";

import {
  getEffectiveProgrammingStatus,
  isActiveProgramming,
  isHistoricalProgramming,
} from "../src/features/programming/availability.ts";

test("una programación pendiente permanece activa aunque su hora ya haya pasado", () => {
  const programming = {
    effectiveStatus: "PENDING_CONFIRMATION",
    reconciliationStatus: null,
  };

  assert.equal(isActiveProgramming(programming), true);
  assert.equal(isHistoricalProgramming(programming), false);
});

test("un despacho completado pero pendiente de conciliación continúa activo", () => {
  const programming = {
    effectiveStatus: "COMPLETED",
    reconciliationStatus: "PENDING_RECONCILIATION",
  };

  assert.equal(isActiveProgramming(programming), true);
  assert.equal(isHistoricalProgramming(programming), false);
});

test("una programación con despacho conciliado pertenece al historial", () => {
  const programming = {
    effectiveStatus: "COMPLETED",
    reconciliationStatus: "RECONCILED",
  };

  assert.equal(isActiveProgramming(programming), false);
  assert.equal(isHistoricalProgramming(programming), true);
});

test("una pendiente de un día anterior se cancela efectivamente y pasa al historial", () => {
  const effectiveStatus = getEffectiveProgrammingStatus(
    {
      status: "PENDING_CONFIRMATION",
      scheduledAt: "2026-09-02T23:30:00-06:00",
      operationStarted: false,
      timezone: "America/Guatemala",
    },
    new Date("2026-09-03T00:05:00-06:00").valueOf(),
  );
  const programming = { effectiveStatus, reconciliationStatus: null };

  assert.equal(effectiveStatus, "CANCELLED");
  assert.equal(isActiveProgramming(programming), false);
  assert.equal(isHistoricalProgramming(programming), true);
});

test("una pendiente del día actual no se cancela por haber pasado su hora", () => {
  const effectiveStatus = getEffectiveProgrammingStatus(
    {
      status: "PENDING_CONFIRMATION",
      scheduledAt: "2026-09-03T08:00:00-06:00",
      operationStarted: false,
      timezone: "America/Guatemala",
    },
    new Date("2026-09-03T18:00:00-06:00").valueOf(),
  );

  assert.equal(effectiveStatus, "PENDING_CONFIRMATION");
});
