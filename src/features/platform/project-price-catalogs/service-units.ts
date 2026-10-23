// Commercial service units are not conversions or operational product units.
export const SERVICE_UNIT_CODES = ["KM", "M", "M3", "UN", "SERVICIO", "COMBO", "RECARGO", "DOSIS/M3"] as const;

export const SERVICE_UNIT_ERROR =
  "La UM debe ser KM, M (metro lineal), M3, U/UN (Unidad o Unitario), Servicio, Combo, Recargo o dosis/m3; también puede quedar vacía.";

// Supplier spreadsheets often use a dash in place of an empty cell.
export function isEmptyServiceUnit(value: string): boolean {
  return /^(?:-|–|—)?$/u.test(value.normalize("NFKC").trim());
}

export function normalizeServiceUnit(value: string): string | null {
  const text = value.normalize("NFKC").trim().toUpperCase().replace(/\s*\/\s*/gu, "/");
  const normalized = ["UNIDAD", "UNITARIO", "U"].includes(text) ? "UN" : text;
  return SERVICE_UNIT_CODES.includes(normalized as (typeof SERVICE_UNIT_CODES)[number])
    ? normalized
    : null;
}
