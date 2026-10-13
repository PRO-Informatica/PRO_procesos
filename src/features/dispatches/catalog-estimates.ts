export function formatDispatchMoney(value: number, currency = "GTQ") {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function normalizeCatalogReference(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
}
