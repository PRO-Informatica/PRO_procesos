// Keep the existing operation-day rule: scheduled date + current local time.
export function getDispatchStartLocalDateTime(
  scheduledAt: string,
  timezone: string,
  now = new Date(),
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });
  const scheduledParts = formatter.formatToParts(new Date(scheduledAt));
  const currentParts = formatter.formatToParts(now);
  const part = (
    parts: Intl.DateTimeFormatPart[],
    type: Intl.DateTimeFormatPartTypes,
  ) => parts.find((item) => item.type === type)!.value;

  return `${part(scheduledParts, "year")}-${part(scheduledParts, "month")}-${part(scheduledParts, "day")}T${part(currentParts, "hour")}:${part(currentParts, "minute")}`;
}
