import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAccountingPeriod,
  formatDashboardDateTime,
  formatDashboardTime,
  formatDateRange,
  formatQuantity,
} from "../src/features/dashboard/formatters.ts";

const unstableIntlCharacters = /[\u00a0\u202f\u200e\u200f]/u;

test("los formatos compartidos por SSR y cliente no conservan separadores Unicode inestables", () => {
  const values = [
    formatDashboardDateTime("2026-09-09T00:32:00Z", "America/Guatemala"),
    formatDashboardTime("2026-09-09T00:32:00Z", "America/Guatemala"),
    formatDateRange("2026-09-07", "2026-09-13", "America/Guatemala"),
    formatAccountingPeriod("2026-09-01", "America/Guatemala"),
    formatQuantity(187),
  ];

  for (const value of values) {
    assert.doesNotMatch(value, unstableIntlCharacters);
  }
});

test("la fecha reciente conserva la zona horaria y el texto esperado", () => {
  assert.equal(
    formatDashboardDateTime("2026-09-09T00:32:00Z", "America/Guatemala"),
    "8/09/2026, 6:32 p. m.",
  );
});
