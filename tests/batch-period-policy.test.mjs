import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { weeklyBatchPeriods, fifthBusinessDay, evaluateInvoicePeriod, projectCalendarDate } from "../src/features/batches/period-policy.ts";

test("semana interna conserva lunes a domingo en un solo mes", () => {
  assert.deepEqual(weeklyBatchPeriods("2026-10-23"), [{ start: "2026-10-19", end: "2026-10-25", accountingPeriod: "2026-10-01" }]);
});

test("si octubre termina martes se crean dos segmentos, no un lote mixto", () => {
  const expected = [
    { start: "2028-10-30", end: "2028-10-31", accountingPeriod: "2028-10-01" },
    { start: "2028-11-01", end: "2028-11-05", accountingPeriod: "2028-11-01" },
  ];
  assert.deepEqual(weeklyBatchPeriods("2028-10-31"), expected);
  assert.deepEqual(weeklyBatchPeriods("2028-11-03"), expected);
});

test("separa cambios de año y febrero bisiesto sin perder ni repetir días", () => {
  assert.deepEqual(weeklyBatchPeriods("2026-01-01"), [
    { start: "2025-12-29", end: "2025-12-31", accountingPeriod: "2025-12-01" },
    { start: "2026-01-01", end: "2026-01-04", accountingPeriod: "2026-01-01" },
  ]);
  assert.deepEqual(weeklyBatchPeriods("2024-02-29"), [
    { start: "2024-02-26", end: "2024-02-29", accountingPeriod: "2024-02-01" },
    { start: "2024-03-01", end: "2024-03-03", accountingPeriod: "2024-03-01" },
  ]);
  assert.throws(() => weeklyBatchPeriods("2026-02-29"), /INVALID_CALENDAR_DATE/u);
});

test("todas las semanas durante cuatro años tienen segmentos contiguos y mensuales", () => {
  for (let day = new Date("2024-01-01T12:00:00Z"); day < new Date("2028-01-01T12:00:00Z"); day.setUTCDate(day.getUTCDate() + 1)) {
    const periods = weeklyBatchPeriods(day.toISOString().slice(0, 10));
    assert.equal(new Date(`${periods[0].start}T12:00:00Z`).getUTCDay(), 1);
    assert.equal(new Date(`${periods.at(-1).end}T12:00:00Z`).getUTCDay(), 0);
    for (const period of periods) {
      assert.equal(period.start.slice(0, 7), period.end.slice(0, 7));
      assert.equal(period.accountingPeriod, `${period.start.slice(0, 7)}-01`);
    }
    if (periods.length === 2) {
      assert.equal((new Date(`${periods[1].start}T12:00:00Z`) - new Date(`${periods[0].end}T12:00:00Z`)) / 86400000, 1);
    }
  }
});

test("gracia cuenta cinco días hábiles, excluyendo sábados y domingos, sin feriados", () => {
  assert.equal(fifthBusinessDay("2026-11-01"), "2026-11-06");
  assert.equal(fifthBusinessDay("2028-11-01"), "2028-11-07");
  assert.equal(fifthBusinessDay("2026-01-01"), "2026-01-07");
  assert.equal(fifthBusinessDay("2026-08-01"), "2026-08-07");
});

test("admite factura de octubre en lote noviembre durante el plazo inclusive", () => {
  for (const receivedDate of ["2028-11-01", "2028-11-02", "2028-11-04", "2028-11-05", "2028-11-07"]) {
    assert.deepEqual(evaluateInvoicePeriod({ invoiceDate: "2028-10-30", accountingPeriod: "2028-11-01", receivedDate }), { valid: true, graceUsed: true, graceDeadline: "2028-11-07" });
  }
});

test("rechaza desde el sexto día hábil, meses más antiguos, futuros y fechas inválidas", () => {
  for (const [invoiceDate, receivedDate] of [["2028-10-30", "2028-11-08"], ["2028-09-30", "2028-11-02"], ["2028-12-01", "2028-11-02"], ["2028-10-30", "2028-10-31"], ["2028-10-30", "2028-12-01"], ["2028-02-30", "2028-11-01"]]) {
    assert.equal(evaluateInvoicePeriod({ invoiceDate, accountingPeriod: "2028-11-01", receivedDate }).valid, false);
  }
});

test("facturas del propio mes mantienen la regla existente", () => {
  assert.deepEqual(evaluateInvoicePeriod({ invoiceDate: "2028-11-15", accountingPeriod: "2028-11-01", receivedDate: "2028-11-20" }), { valid: true, graceUsed: false, graceDeadline: "2028-11-07" });
});

test("el límite usa la fecha del proyecto, no UTC ni el reloj del navegador", () => {
  assert.equal(projectCalendarDate("America/Guatemala", new Date("2028-11-08T05:59:59Z")), "2028-11-07");
  assert.equal(projectCalendarDate("America/Guatemala", new Date("2028-11-08T06:00:00Z")), "2028-11-08");
  assert.equal(projectCalendarDate("invalid", new Date("2028-11-08T05:59:59Z")), "2028-11-07");
  assert.equal(projectCalendarDate(undefined, new Date("2028-11-08T05:59:59Z")), "2028-11-07");
});

test("el cambio protege los RPC directos, congela recepción y conserva los datos históricos", async () => {
  const migration = await readFile(new URL("../supabase/migrations/114_monthly_batch_segments_invoice_grace.sql", import.meta.url), "utf8");
  assert.match(migration, /BATCH_OVERDUE_OPEN_EXISTS/u);
  assert.match(migration, /BATCH_DESTINATION_CLOSED/u);
  assert.match(migration, /create trigger guard_batch_month_segment/u);
  assert.match(migration, /create trigger guard_invoice_accounting_period/u);
  assert.match(migration, /clock_timestamp\(\)/u);
  assert.match(migration, /v_snapshot := old.normalized_payload -> 'period_validation'/u);
  assert.doesNotMatch(migration, /delete from public\.(batches|dispatches|invoices)/iu);
  assert.doesNotMatch(migration, /update public\.dispatches/iu);
  const dialog = await readFile(new URL("../src/features/batches/components/batch-dialogs.tsx", import.meta.url), "utf8");
  assert.match(dialog, /Se crearán dos lotes/u);
  assert.match(dialog, /name="confirmSplit"/u);
});
