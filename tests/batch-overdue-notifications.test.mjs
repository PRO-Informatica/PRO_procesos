import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { batchWeekEnd, batchOverdueAt, isBatchWeekOverdue, projectCalendarDate } from "../src/features/batches/period-policy.ts";
import { batchOverdueNotifications } from "../src/features/notifications/batch-alerts.ts";

const batch = { id: "batch-1", code: "LOT-2026-10-12", periodStart: "2026-10-12", periodEnd: "2026-10-18", createdAt: "2026-10-12T06:00:00Z" };
const context = { projectId: "project-1", projectName: "Proyecto 1", timezone: "America/Guatemala" };
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("no alerta el domingo: solo después del domingo y mientras siga OPEN", () => {
  assert.equal(isBatchWeekOverdue("OPEN", batch.periodStart, "2026-10-18"), false);
  assert.equal(isBatchWeekOverdue("OPEN", batch.periodStart, "2026-10-19"), true);
  assert.equal(isBatchWeekOverdue("CLOSED", batch.periodStart, "2026-10-19"), false);
});

test("la excepción de dos meses no vence el primer segmento antes del domingo", () => {
  assert.equal(batchWeekEnd("2028-10-30"), "2028-11-05");
  assert.equal(batchWeekEnd("2028-11-01"), "2028-11-05");
  assert.equal(isBatchWeekOverdue("OPEN", "2028-10-30", "2028-11-01"), false);
  assert.equal(isBatchWeekOverdue("OPEN", "2028-10-30", "2028-11-05"), false);
  assert.equal(isBatchWeekOverdue("OPEN", "2028-10-30", "2028-11-06"), true);
  assert.equal(isBatchWeekOverdue("OPEN", "2028-11-01", "2028-11-06"), true);
});

test("activa alerta a medianoche del proyecto, no a medianoche UTC", () => {
  assert.equal(batchOverdueAt(batch.periodStart, context.timezone), "2026-10-19T06:00:00.000Z");
  assert.equal(isBatchWeekOverdue("OPEN", batch.periodStart, projectCalendarDate(context.timezone, new Date("2026-10-19T05:59:59Z"))), false);
  assert.equal(isBatchWeekOverdue("OPEN", batch.periodStart, projectCalendarDate(context.timezone, new Date("2026-10-19T06:00:00Z"))), true);
  assert.equal(batchOverdueAt("2026-10-26", "America/New_York"), "2026-11-02T05:00:00.000Z");
});

test("una alerta por lote tiene clave estable, proyecto y enlace correctos", () => {
  const first = batchOverdueNotifications([batch], context);
  const reload = batchOverdueNotifications([batch], context);
  assert.equal(first.length, 1);
  assert.deepEqual(first, reload);
  assert.equal(first[0].key, "batch-overdue:batch-1");
  assert.equal(first[0].type, "BATCH");
  assert.equal(first[0].projectId, context.projectId);
  assert.equal(first[0].href, "/batches/batch-1");
  assert.match(first[0].description, /Ciérralo/u);
  assert.deepEqual(batchOverdueNotifications([], context), []);
});

test("marcar todas antes de vencer no oculta una alerta futura; nuevas altas históricas se fechan al crearse", () => {
  const [notification] = batchOverdueNotifications([batch], context);
  assert.ok(new Date(notification.createdAt) > new Date("2026-10-18T23:00:00Z"));
  assert.ok(new Date(notification.createdAt) <= new Date("2026-10-19T07:00:00Z"));
  const [late] = batchOverdueNotifications([{ ...batch, createdAt: "2026-10-23T15:30:00Z" }], context);
  assert.equal(late.createdAt, "2026-10-23T15:30:00Z");
});

test("la consulta es por proyecto, OPEN, semanas anteriores y sin truncarse al historial reciente", async () => {
  const query = await read("../src/features/batches/overdue-queries.ts");
  assert.match(query, /\.eq\("project_id", projectId\)\.eq\("status", "OPEN"\)/u);
  assert.match(query, /\.lt\("period_start", monday\)/u);
  assert.match(query, /count: "exact"/u);
  assert.match(query, /cache\(async/u);
  assert.doesNotMatch(query, /createAdminClient|service_role|\.insert\(|\.upsert\(/u);
  const notifications = await read("../src/features/notifications/queries.ts");
  assert.match(notifications, /permissions\.includes\("batch\.view"\) \? getOverdueBatchAlerts/u);
  assert.match(notifications, /readMap\.has\(item.key\)/u);
});

test("la alerta permanece en Lotes independientemente de lectura y aparece en detalle y Universal", async () => {
  const workspace = await read("../src/features/batches/components/batches-workspace.tsx");
  const detail = await read("../src/features/batches/components/batch-detail-view.tsx");
  const universal = await read("../src/features/batches/components/universal-batches-workspace.tsx");
  const notice = await read("../src/features/batches/components/overdue-batch-notice.tsx");
  assert.match(workspace, /OverdueBatchNotice overdue=\{data.overdue\}/u);
  assert.match(detail, /detail\.isOverdue && <OverdueBatchNotice/u);
  assert.match(universal, /batch\.isOverdue/u);
  assert.match(notice, /role="alert"/u);
  assert.doesNotMatch(notice, /notification_reads|readMap|read_at/u);
});

test("cerrar un lote refresca el centro de alertas y el contador del layout", async () => {
  const actions = await read("../src/features/batches/actions.ts");
  const rollover = actions.slice(actions.indexOf("export async function rolloverBatchAction"), actions.indexOf("export async function inspectDispatchInvoicePdf"));
  assert.match(rollover, /revalidatePath\("\/notifications"\)/u);
  assert.match(rollover, /revalidatePath\("\/\(dashboard\)", "layout"\)/u);
});
