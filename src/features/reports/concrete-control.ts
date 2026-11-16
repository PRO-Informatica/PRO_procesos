import type { RadarDispatch, RadarGuide, RadarLine } from "./radar.ts";

export const CONCRETE_STRENGTHS = [4000, 5000, 6000, 7000, 8000] as const;
export type ConcreteCategory = "concrete" | "pumping" | "surcharge" | "finishing" | "other";
export type ControlAmount = { value: number | null; known: number; pending: number };
export type ConcreteStrength = { label: string; quantity: number; unitPrice: number | null; amount: ControlAmount };
export type ConcreteControlRow = {
  guide: RadarGuide;
  strengths: ConcreteStrength[];
  concreteVolume: number;
  concrete: ControlAmount;
  pumpingVolume: number | null;
  pumping: ControlAmount;
  consumedVolume: number | null;
  surcharge: ControlAmount;
  finishing: ControlAmount;
  other: ControlAmount;
  total: ControlAmount;
  warnings: string[];
};

export const controlRound = (value: number, decimals = 4) => Math.round((value + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
function normalized(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toUpperCase(); }
export function isConcreteVolume(line: RadarLine) { return line.type === "PRODUCT" && /^m[3³]$/iu.test(line.unit.trim()); }

// Strength is taken from explicit PSI text, never guessed from a numeric product code.
export function concreteStrength(line: RadarLine) {
  const match = /\b(\d{1,2}(?:[,. ]\d{3})|\d{4,5})\s*PSI\b/iu.exec(`${line.description} ${line.reference}`);
  return match ? Number(match[1].replace(/[,. ]/gu, "")) : null;
}

export function controlLineCategory(line: RadarLine): ConcreteCategory {
  if (isConcreteVolume(line)) return "concrete";
  if (line.type !== "SERVICE") return "other";
  const label = normalized(`${line.reference} ${line.description}`);
  if (/\b(?:RECARGO\w*|SOBRECARGO\w*)\b/u.test(label)) return "surcharge";
  if (/\b(?:ALISADO\w*|ALLANADO\w*)\b/u.test(label)) return "finishing";
  if (/\b(?:BOMBA\w*|BOMBEO\w*|COLOCACION\w*)\b/u.test(label)) return "pumping";
  return "other";
}

export function controlLineSubtotal(line: RadarLine): number | null {
  if (line.quantity === 0) return 0;
  // An absent currency is not silently treated as GTQ. Historical prices stay untouched.
  if (line.currency?.trim().toUpperCase() !== "GTQ") return null;
  if (typeof line.estimatedSubtotal === "number" && Number.isFinite(line.estimatedSubtotal)) return controlRound(line.estimatedSubtotal, 2);
  if (typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice)) return controlRound(line.quantity * line.unitPrice, 2);
  return null;
}

function amount(lines: RadarLine[]): ControlAmount {
  const values = lines.map(controlLineSubtotal);
  const pending = values.filter((value) => value === null).length;
  const known = controlRound(values.reduce<number>((sum, value) => sum + (value ?? 0), 0), 2);
  return { value: pending ? null : known, known, pending };
}
function addAmounts(values: ControlAmount[]): ControlAmount {
  const pending = values.reduce((sum, value) => sum + value.pending, 0);
  const known = controlRound(values.reduce((sum, value) => sum + value.known, 0), 2);
  return { value: pending ? null : known, known, pending };
}

function pumpingVolume(input: RadarLine[], warnings: string[]) {
  const lines = input.filter((line) => line.quantity !== 0);
  if (!lines.length) return 0;
  const volumes = lines.filter((line) => /^m[3³]$/iu.test(line.unit.trim()));
  if (!volumes.length) {
    warnings.push("Bomba/colocación sin volumen registrado en m³; consumo pendiente.");
    return null;
  }
  // Bomba and colocación cover the same concrete. Count that volume once, as in the template.
  const pumping = volumes.filter((line) => !/\bCOLOCACION\w*\b/u.test(normalized(`${line.reference} ${line.description}`)));
  const placement = volumes.filter((line) => !pumping.includes(line));
  const sum = (rows: RadarLine[]) => controlRound(rows.reduce((total, line) => total + line.quantity, 0));
  if (pumping.length && placement.length && sum(pumping) !== sum(placement)) {
    warnings.push("Volúmenes de bomba y colocación distintos; revisar el volumen antes de calcular el consumo.");
    return null;
  }
  return sum(pumping.length ? pumping : placement);
}

export function makeConcreteControlRow(guide: RadarGuide): ConcreteControlRow {
  const warnings: string[] = [];
  const concreteLines = guide.lines.filter(isConcreteVolume);
  const strengthKeys = [...CONCRETE_STRENGTHS.map(String), ...new Set(concreteLines.map((line) => String(concreteStrength(line) ?? "unknown")))];
  const strengths = [...new Set(strengthKeys)].map((key): ConcreteStrength => {
    const lines = concreteLines.filter((line) => String(concreteStrength(line) ?? "unknown") === key);
    const quantity = controlRound(lines.reduce((sum, line) => sum + line.quantity, 0));
    const subtotal = amount(lines);
    return { label: key === "unknown" ? "Sin resistencia identificada" : `${key} PSI`, quantity, unitPrice: quantity && subtotal.value !== null ? controlRound(subtotal.value / quantity) : null, amount: subtotal };
  });
  if (concreteLines.some((line) => concreteStrength(line) === null)) warnings.push("Hay concreto sin resistencia PSI identificada; se incluye en el volumen y el subtotal.");
  const category = (name: ConcreteCategory) => guide.lines.filter((line) => controlLineCategory(line) === name);
  const concreteVolume = controlRound(concreteLines.reduce((sum, line) => sum + line.quantity, 0));
  const pumpVolume = pumpingVolume(category("pumping"), warnings);
  const total = amount(guide.lines);
  if (!guide.lines.length) warnings.push("Guía sin líneas registradas.");
  if (total.pending) warnings.push(`${total.pending} línea(s) con precio pendiente o moneda distinta de GTQ; total pendiente.`);
  return {
    guide, strengths, concreteVolume, concrete: amount(concreteLines),
    pumpingVolume: pumpVolume, pumping: amount(category("pumping")),
    consumedVolume: pumpVolume === null ? null : controlRound((concreteVolume + pumpVolume) / 2),
    surcharge: amount(category("surcharge")), finishing: amount(category("finishing")), other: amount(category("other")), total, warnings,
  };
}

export function concreteControlTotals(rows: ConcreteControlRow[]) {
  const volume = (key: "concreteVolume" | "pumpingVolume" | "consumedVolume") => rows.some((row) => row[key] === null) ? null : controlRound(rows.reduce((sum, row) => sum + (row[key] ?? 0), 0));
  return {
    concreteVolume: volume("concreteVolume")!, pumpingVolume: volume("pumpingVolume"), consumedVolume: volume("consumedVolume"),
    concrete: addAmounts(rows.map((row) => row.concrete)), pumping: addAmounts(rows.map((row) => row.pumping)),
    surcharge: addAmounts(rows.map((row) => row.surcharge)), finishing: addAmounts(rows.map((row) => row.finishing)),
    other: addAmounts(rows.map((row) => row.other)), total: addAmounts(rows.map((row) => row.total)),
  };
}

export function buildConcreteControl(dispatch: RadarDispatch) {
  const rows = dispatch.guides.map(makeConcreteControlRow);
  return { rows, totals: concreteControlTotals(rows) };
}

// Fixed separators avoid Intl whitespace differences between server and browser hydration.
export function controlNumber(value: number | null, decimals = 2) {
  if (value === null) return "Pendiente";
  const [whole, fraction] = value.toFixed(decimals).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${fraction ? `.${fraction}` : ""}`;
}
export function controlMoney(value: number | null) { return value === null ? "Pendiente" : `Q ${controlNumber(value)}`; }
