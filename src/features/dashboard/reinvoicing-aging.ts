export const DAY_MS = 86_400_000;
export const REINVOICING_ALERT_DAYS = 7;

export type ReinvoicingRequest = { kind: "Producto" | "Servicio"; startedAt: number | null };

export type ReinvoicingCase = {
  id: string;
  code: string;
  orderNumber: string | null;
  programmingCode: string;
  requests: ReinvoicingRequest[];
  startedAt: number | null;
};

export type ReinvoicingAging = { asOf: number; cases: ReinvoicingCase[] };

export function agingPlotLimit(asOf: number, cases: ReinvoicingCase[]) {
  const maxAge = cases.reduce((max, { startedAt }) => startedAt === null ? max : Math.max(max, (asOf - startedAt) / DAY_MS), 0);
  return Math.max(2, Math.ceil(maxAge / REINVOICING_ALERT_DAYS)) * REINVOICING_ALERT_DAYS;
}

export function dispatchAgingSamples(asOf: number, days: number, startedAt: number) {
  const from = asOf - days * DAY_MS;
  const samples = new Set(Array.from({ length: days + 1 }, (_, i) => from + i * DAY_MS));
  if (startedAt >= from && startedAt <= asOf) samples.add(startedAt);
  return [...samples].sort((a, b) => a - b).map((time) => ({
    time, age: time < startedAt ? null : (time - startedAt) / DAY_MS,
  }));
}

export function projectAgingSamples(asOf: number, days: number, cases: ReinvoicingCase[]) {
  const starts = cases.flatMap(({ startedAt }) => startedAt === null ? [] : [startedAt]).sort((a, b) => a - b);
  let count = 0;
  let totalStarts = 0;
  return Array.from({ length: days + 1 }, (_, i) => {
    const time = asOf - (days - i) * DAY_MS;
    while (count < starts.length && starts[count] <= time) totalStarts += starts[count++];
    return {
      time,
      average: count ? (time - totalStarts / count) / DAY_MS : null,
      longest: count ? (time - starts[0]) / DAY_MS : null,
    };
  });
}

export function formatReinvoicingAge(elapsedMs: number) {
  const hours = Math.max(0, Math.floor(elapsedMs / 3_600_000));
  if (hours === 0) return "Menos de 1 h";
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return [days > 0 ? `${days} d` : "", remainingHours ? `${remainingHours} h` : ""].filter(Boolean).join(" ");
}
