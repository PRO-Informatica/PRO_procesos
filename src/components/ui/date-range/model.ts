export type DateRange = { from: string; to: string };
export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function dateValue(iso: string) { return new Date(`${iso}T12:00:00Z`); }
export function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
export function shiftDate(iso: string, days: number) {
  const date = dateValue(iso); date.setUTCDate(date.getUTCDate() + days); return isoDate(date);
}
export function monthStart(iso: string) { return `${iso.slice(0, 7)}-01`; }
export function shiftMonth(iso: string, months: number) {
  const date = dateValue(monthStart(iso)); date.setUTCMonth(date.getUTCMonth() + months);
  return isoDate(date);
}
export function monthDays(iso: string) {
  const start = monthStart(iso), next = shiftMonth(start, 1);
  const count = Math.round((dateValue(next).getTime() - dateValue(start).getTime()) / 86400000);
  return { offset: (dateValue(start).getUTCDay() + 6) % 7, dates: Array.from({ length: count }, (_, i) => shiftDate(start, i)) };
}
export function orderedRange(a: string, b: string): DateRange { return a <= b ? { from: a, to: b } : { from: b, to: a }; }
export function rangeDays(from: string, to: string) { return Math.round((dateValue(to).getTime() - dateValue(from).getTime()) / 86400000) + 1; }
export function dateLabel(iso: string) {
  const date = dateValue(iso); return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()].slice(0, 3)} ${date.getUTCFullYear()}`;
}
