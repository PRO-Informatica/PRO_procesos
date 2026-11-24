import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { weeklyBatchPeriod, historicalBatchPeriod, latestHistoricalBatchDate, batchPeriodLabel, batchAccountingEnd, fifthBusinessDay, evaluateInvoicePeriod, projectCalendarDate } from "../src/features/batches/period-policy.ts";

test("una semana dentro de un mes cubre de lunes a domingo", () => {
  assert.deepEqual(weeklyBatchPeriod("2026-10-23"), { start: "2026-10-19", end: "2026-10-25", accountingPeriod: "2026-10-01" });
  assert.equal(batchPeriodLabel("WEEKLY", "2026-10-19", "2026-10-25"), "Lote semanal");
});

test("una semana que termina en otro mes es un solo lote compartido", () => {
  const expected = { start: "2028-10-30", end: "2028-11-05", accountingPeriod: "2028-10-01" };
  assert.deepEqual(weeklyBatchPeriod("2028-10-31"), expected);
  assert.deepEqual(weeklyBatchPeriod("2028-11-03"), expected);
  assert.equal(batchPeriodLabel("WEEKLY", expected.start, expected.end), "Lote compartido");
  assert.equal(batchPeriodLabel("HISTORICAL", expected.start, expected.end), "Lote histórico");
});

test("el cambio de año y febrero bisiesto conservan una única semana completa", () => {
  assert.deepEqual(weeklyBatchPeriod("2026-01-01"), { start: "2025-12-29", end: "2026-01-04", accountingPeriod: "2025-12-01" });
  assert.deepEqual(weeklyBatchPeriod("2024-02-29"), { start: "2024-02-26", end: "2024-03-03", accountingPeriod: "2024-02-01" });
  assert.throws(() => weeklyBatchPeriod("2026-02-29"), /INVALID_CALENDAR_DATE/u);
});

test("todas las referencias de calendario caen en la semana completa que las contiene", () => {
  for (let day = new Date("2024-01-01T12:00:00Z"); day < new Date("2028-01-01T12:00:00Z"); day.setUTCDate(day.getUTCDate() + 1)) {
    const reference = day.toISOString().slice(0, 10);
    const period = weeklyBatchPeriod(reference);
    assert.ok(period.start <= reference && reference <= period.end);
    assert.equal(new Date(period.start).getUTCDay(), 1);
    assert.equal((new Date(period.end) - new Date(period.start)) / 86400000, 6);
    assert.equal(period.accountingPeriod, `${period.start.slice(0, 7)}-01`);
  }
});

test("el rango histórico permite cualquier intervalo ordenado hasta ayer inclusive", () => {
  const today = "2026-11-19";
  assert.equal(latestHistoricalBatchDate(today), "2026-11-18");
  assert.deepEqual(historicalBatchPeriod("2026-09-15", "2026-11-18", today),
    { start: "2026-09-15", end: "2026-11-18", accountingPeriod: "2026-09-01" });
  assert.equal(historicalBatchPeriod("2026-11-18", "2026-11-18", today).end, "2026-11-18");
  for (const [start, end] of [["2026-11-01", today], ["2026-11-18", "2026-11-21"], ["2026-11-18", "2026-10-25"], ["2026-02-29", "2026-11-01"]]) {
    assert.throws(() => historicalBatchPeriod(start, end, today));
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

test("el lote compartido acepta ambos meses y mantiene la gracia del mes precedente", () => {
  const context = { accountingPeriod: "2028-10-01", accountingEnd: "2028-11-05", receivedDate: "2028-10-06" };
  for (const invoiceDate of ["2028-10-31", "2028-11-02"]) {
    assert.deepEqual(evaluateInvoicePeriod({ ...context, invoiceDate }), { valid: true, graceUsed: false, graceDeadline: "2028-10-06" });
  }
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2028-09-30" }).graceUsed, true);
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2028-09-30", receivedDate: "2028-10-09" }).valid, false);
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2028-12-02" }).valid, false);
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2028-11-02", accountingEnd: batchAccountingEnd("LEGACY", "2028-11-05") }).valid, false);
});

test("las facturas de los meses incluidos en un rango histórico se pueden cargar después", () => {
  const context = { accountingPeriod: "2026-06-01", accountingEnd: "2026-09-02", receivedDate: "2026-11-19" };
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2026-07-20" }).valid, true);
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2026-09-01" }).valid, true);
  assert.equal(evaluateInvoicePeriod({ ...context, invoiceDate: "2026-05-28" }).valid, false);
});

test("el cambio protege los RPC directos, congela recepción y conserva los datos históricos", async () => {
  const migration = await readFile(new URL("../supabase/migrations/149_weekly_shared_and_historical_batches.sql", import.meta.url), "utf8");
  for (const guard of ["BATCH_OVERDUE_OPEN_EXISTS", "BATCH_DESTINATION_CLOSED", "BATCH_MONDAY_TO_SUNDAY_REQUIRED", "BATCH_HISTORICAL_RANGE_INVALID", "BATCH_HISTORICAL_DISPATCH_DATE_INVALID"]) {
    assert.ok(migration.includes(guard));
  }
  assert.match(migration, /create trigger guard_batch_period/u);
  assert.match(migration, /clock_timestamp\(\)/u);
  assert.match(migration, /v_snapshot := old.normalized_payload -> 'period_validation'/u);
  assert.doesNotMatch(migration, /delete from public\.(batches|dispatches|invoices)/iu);
  assert.doesNotMatch(migration, /update public\.dispatches/iu);
  const dialog = await readFile(new URL("../src/features/batches/components/batch-dialogs.tsx", import.meta.url), "utf8");
  assert.match(dialog, /name="period(Start|End)" type="date"/u);
  assert.doesNotMatch(dialog, /name="confirmSplit"/u);
});
