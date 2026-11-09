export const CASTING_ELEMENTS = {
  PILES: "Pilotes",
  COLUMNS: "Columnas",
  PILES_AND_COLUMNS: "Pilotes y columnas",
} as const;
export type CastingElement = keyof typeof CASTING_ELEMENTS;

export function normalizeCastingElement(value: string | null | undefined): CastingElement | null {
  const text = (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toUpperCase().trim();
  if (Object.hasOwn(CASTING_ELEMENTS, text)) return text as CastingElement;
  const piles = /\bPILOT(?:E|ES)?\b/u.test(text);
  const columns = /\bCOLUMNA(?:S)?\b/u.test(text);
  return piles && columns ? "PILES_AND_COLUMNS" : piles ? "PILES" : columns ? "COLUMNS" : null;
}
