// Commercial service units are not conversions or operational product units.
export const SERVICE_UNIT_CODES = ["KM", "M3", "UN", "SERVICIO", "COMBO", "RECARGO", "DOSIS/M3"] as const;

export const SERVICE_UNIT_ERROR =
  "La UM debe ser KM, M3, UN (Unidad), Servicio, Combo, Recargo o dosis/m3.";

export function normalizeServiceUnit(value: string): string | null {
  const text = value.normalize("NFKC").trim().toUpperCase().replace(/\s*\/\s*/gu, "/");
  const normalized = text === "UNIDAD" ? "UN" : text;
  return SERVICE_UNIT_CODES.includes(normalized as (typeof SERVICE_UNIT_CODES)[number])
    ? normalized
    : null;
}
