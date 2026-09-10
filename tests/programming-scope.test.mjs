import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getEffectiveProgrammingStatus,
  isActiveProgramming,
  isHistoricalProgramming,
} from "../src/features/programming/availability.ts";

const programmingCalendar = await readFile(
  new URL(
    "../src/features/programming/components/programming-calendar.tsx",
    import.meta.url,
  ),
  "utf8",
);
const programmingFormatters = await readFile(
  new URL("../src/features/programming/formatters.ts", import.meta.url),
  "utf8",
);

test("el calendario móvil conserva Mes como primera vista compatible", () => {
  const viewsSection = programmingCalendar.slice(
    programmingCalendar.indexOf("views: ["),
    programmingCalendar.indexOf("defaultView:"),
  );

  assert.ok(
    viewsSection.indexOf("createViewMonthAgenda()") <
      viewsSection.indexOf("createViewDay()"),
  );
  assert.match(programmingCalendar, /defaultView: "month-grid"/u);
});

test("una programación pendiente permanece activa aunque su hora ya haya pasado", () => {
  const programming = {
    effectiveStatus: "PENDING_CONFIRMATION",
  };

  assert.equal(isActiveProgramming(programming), true);
  assert.equal(isHistoricalProgramming(programming), false);
});

test("una programación en ejecución sigue activa aunque Producto ya esté conciliado", () => {
  const programming = {
    effectiveStatus: "IN_EXECUTION",
  };

  assert.equal(isActiveProgramming(programming), true);
  assert.equal(isHistoricalProgramming(programming), false);
});

test("una programación completada aparece en Activas y también en Historial", () => {
  const programming = {
    effectiveStatus: "COMPLETED",
  };

  assert.equal(isActiveProgramming(programming), true);
  assert.equal(isHistoricalProgramming(programming), true);
});

test("Completado utiliza el tono morado del sistema en Programación y calendario", () => {
  assert.match(programmingFormatters, /COMPLETED: "bg-violet-100 text-violet-800/u);
  assert.match(
    programmingCalendar,
    /completed:[\s\S]*main: "#7c3aed"[\s\S]*container: "#ede9fe"/u,
  );
});

test("una pendiente de un día anterior se cancela pero permanece solo en la vista general", () => {
  const effectiveStatus = getEffectiveProgrammingStatus(
    {
      status: "PENDING_CONFIRMATION",
      scheduledAt: "2026-09-02T23:30:00-06:00",
      operationStarted: false,
      timezone: "America/Guatemala",
    },
    new Date("2026-09-03T00:05:00-06:00").valueOf(),
  );
  const programming = { effectiveStatus };

  assert.equal(effectiveStatus, "CANCELLED");
  assert.equal(isActiveProgramming(programming), true);
  assert.equal(isHistoricalProgramming(programming), false);
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
