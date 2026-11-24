export type BatchPeriod = {
  start: string;
  end: string;
  accountingPeriod: string;
};
export type BatchPeriodKind = "LEGACY" | "WEEKLY" | "HISTORICAL";

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_CALENDAR_DATE");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error("INVALID_CALENDAR_DATE");
  return parsed;
}

function iso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function shift(value: string, days: number) {
  const parsed = date(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return iso(parsed);
}

export function weeklyBatchPeriod(reference: string): BatchPeriod {
  const parsed = date(reference);
  const monday = shift(reference, 1 - (parsed.getUTCDay() || 7));
  return { start: monday, end: shift(monday, 6), accountingPeriod: `${monday.slice(0, 7)}-01` };
}

export function historicalBatchPeriod(start: string, end: string, today: string): BatchPeriod {
  date(start);
  date(end);
  date(today);
  if (start > end || end >= today) throw new Error("BATCH_HISTORICAL_RANGE_INVALID");
  return { start, end, accountingPeriod: `${start.slice(0, 7)}-01` };
}

export function latestHistoricalBatchDate(today: string) {
  return shift(today, -1);
}

export function batchPeriodLabel(kind: BatchPeriodKind, start: string, end: string) {
  if (kind === "HISTORICAL") return "Lote histórico";
  if (kind === "WEEKLY" && start.slice(0, 7) !== end.slice(0, 7)) return "Lote compartido";
  return "Lote semanal";
}

export function batchAccountingEnd(kind: BatchPeriodKind, periodEnd: string) {
  return kind === "LEGACY" ? undefined : periodEnd;
}

export function batchWeekEnd(periodStart: string) {
  return weeklyBatchPeriod(periodStart).end;
}

/** Matches the DB guard: the Sunday of the whole week must have passed. */
export function isBatchWeekOverdue(status: string, periodStart: string, today: string) {
  date(today);
  return status === "OPEN" && batchWeekEnd(periodStart) < today;
}

/** Event time, not batch creation time: old "mark all read" must not hide a new alert. */
export function batchOverdueAt(periodStart: string, timezone: string) {
  const midnight = shift(batchWeekEnd(periodStart), 1);
  const desired = new Date(`${midnight}T00:00:00Z`).getTime();
  let formatter: Intl.DateTimeFormat;
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  try { formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: timezone || "America/Guatemala" }); }
  catch { formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "America/Guatemala" }); }
  let guess = desired;
  // Same project-local midnight resolution used by programming queries.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((row) => row.type === type)?.value);
    const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}

export function projectCalendarDate(timezone: string, instant = new Date()) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((row) => row.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Saturday/Sunday are excluded. There is deliberately no holiday calendar. */
export function fifthBusinessDay(month: string) {
  date(month);
  let cursor = `${month.slice(0, 7)}-01`;
  let count = 0;
  while (count < 5) {
    const day = date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    if (count < 5) cursor = shift(cursor, 1);
  }
  return cursor;
}

export function evaluateInvoicePeriod(input: {
  invoiceDate: string;
  accountingPeriod: string;
  accountingEnd?: string;
  receivedDate: string;
}) {
  try {
    date(input.invoiceDate); date(input.accountingPeriod); date(input.receivedDate);
    const monthStart = `${input.accountingPeriod.slice(0, 7)}-01`;
    if (input.accountingEnd) date(input.accountingEnd);
    const lastMonth = (input.accountingEnd ?? monthStart).slice(0, 7);
    const graceDeadline = fifthBusinessDay(monthStart);
    const invoiceMonth = input.invoiceDate.slice(0, 7);
    const coveredMonth = invoiceMonth >= monthStart.slice(0, 7) && invoiceMonth <= lastMonth;
    const graceUsed = invoiceMonth === shift(monthStart, -1).slice(0, 7) &&
      input.receivedDate >= monthStart && input.receivedDate <= graceDeadline;
    return { valid: coveredMonth || graceUsed, graceUsed, graceDeadline };
  } catch {
    return { valid: false, graceUsed: false, graceDeadline: null };
  }
}
