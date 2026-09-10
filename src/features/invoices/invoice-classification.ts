export type ClassifiedInvoiceType = "PRODUCT" | "SERVICE" | "UNKNOWN";

export type ClassifiableInvoiceLine = {
  code: string;
  description: string;
};

function normalizedDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function classifyInvoiceLine(line: ClassifiableInvoiceLine) {
  const code = line.code.trim().toUpperCase();
  const description = normalizedDescription(line.description);
  return {
    product: /^\d+$/.test(code) && description.startsWith("CON"),
    service:
      /^SERV\d*/.test(code) ||
      /^(BOMBEO|DOSIS|KM\.? EXTRA|SERVICIO|TRANSPORTE)/.test(description),
  };
}

export function classifyInvoiceLines(
  lines: ClassifiableInvoiceLine[],
): ClassifiedInvoiceType {
  if (lines.some((line) => classifyInvoiceLine(line).product)) return "PRODUCT";
  if (lines.some((line) => classifyInvoiceLine(line).service)) return "SERVICE";
  return "UNKNOWN";
}
