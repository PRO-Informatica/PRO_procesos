import assert from "node:assert/strict";
import test from "node:test";
import { dateLabel, monthDays, orderedRange, rangeDays, shiftDate, shiftMonth } from "../src/components/ui/date-range/model.ts";
import { parseUniversalGuideReportFilters, reportSearchParams } from "../src/features/reports/filters.ts";

test("el calendario usa semanas de lunes y conserva años bisiestos", () => {
  const february = monthDays("2024-02-01");
  assert.equal(february.offset, 3);
  assert.equal(february.dates.length, 29);
  assert.equal(february.dates.at(-1), "2024-02-29");
  assert.equal(monthDays("2026-02-01").dates.length, 28);
  assert.equal(shiftMonth("2026-12-31", 1), "2027-01-01");
});

test("un rango inverso se ordena y cuenta días de calendario, incluso en cambios de horario", () => {
  assert.deepEqual(orderedRange("2026-11-06", "2026-10-21"), { from: "2026-10-21", to: "2026-11-06" });
  assert.equal(rangeDays("2026-10-21", "2026-11-06"), 17);
  assert.equal(rangeDays("2026-03-07", "2026-03-09"), 3);
  assert.equal(rangeDays("2026-11-01", "2026-11-01"), 1);
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(dateLabel("2026-11-17"), "17 nov 2026");
});

test("la URL de consulta y exportación conserva el rango y proyecto sin filtros retirados", () => {
  const filters = parseUniversalGuideReportFilters(new URLSearchParams("from=2026-11-06&to=2026-10-21&project=company-b&supplier=other&programmingStatus=CANCELLED&billing=reconciled"));
  assert.equal(filters.dateFrom, "2026-10-21");
  assert.equal(filters.dateTo, "2026-11-06");
  const params = reportSearchParams(filters);
  assert.equal(params.get("project"), "company-b");
  assert.equal(params.get("billing"), "reconciled");
  assert.equal(params.has("supplier"), false);
  assert.equal(params.has("programmingStatus"), false);
});
