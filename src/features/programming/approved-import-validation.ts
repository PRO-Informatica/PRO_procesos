// Approved Excel imports may contain historical dates. Validate the actual
// calendar/time value, not its position relative to the current day.
export function isValidApprovedProgrammingDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || value.startsWith("0000-")) {
    return false;
  }
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 16) === value;
}
