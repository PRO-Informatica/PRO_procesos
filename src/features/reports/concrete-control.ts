import type { RadarDispatch, RadarLine } from "./radar.ts";

export const CONCRETE_STRENGTHS = [4000, 5000, 6000, 7000, 8000] as const;
export type ConcreteCategory = "concrete" | "pumping" | "surcharge" | "finishing" | "other";
export type ControlAmount = { value: number | null; known: number; pending: number };
type ConcreteStrength = { quantity: number; unitPrice: number | null; amount: ControlAmount };

export const controlRound = (value: number, decimals = 4) => Math.round((value + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
function normalized(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toUpperCase(); }
export function isConcreteVolume(line: RadarLine) { return line.type === "PRODUCT" && /^m[3³]$/iu.test(line.unit.trim()); }

// Quoted PSI takes priority; explicit guide text remains a fallback for legacy catalogs.
export function concreteStrength(line: RadarLine) {
  if (Number.isInteger(line.resistancePsi) && line.resistancePsi! > 0 && line.resistancePsi! <= 99999) return line.resistancePsi!;
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

export function groupControlLines<Key>(lines: RadarLine[], keyFor: (line: RadarLine) => Key) {
  const groups = new Map<Key, RadarLine[]>();
  for (const line of lines) {
    const key = keyFor(line);
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }
  return groups;
}

const finitePrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Resolve report pricing without replacing the commercial snapshot in the guide.
// Product quotations are in GTQ; an explicit foreign currency is never converted.
export function controlLinePricing(line: RadarLine) {
  const currency = line.currency?.trim().toUpperCase() || null;
  const hasSubtotal = finitePrice(line.estimatedSubtotal), hasPrice = finitePrice(line.unitPrice);
  const fromQuotation = isConcreteVolume(line) && !hasSubtotal && !hasPrice
    && (!currency || currency === "GTQ") && finitePrice(line.quotationUnitPrice) && line.quotationUnitPrice >= 0;
  const unitPrice = fromQuotation ? line.quotationUnitPrice! : hasPrice ? line.unitPrice! : null;
  const resolvedCurrency = fromQuotation ? "GTQ" : currency;
  const subtotalInCurrency = line.quantity === 0 ? 0
    : hasSubtotal ? controlRound(line.estimatedSubtotal!, 2)
    : unitPrice === null ? null : controlRound(line.quantity * unitPrice, 2);
  const subtotal = line.quantity === 0 || resolvedCurrency === "GTQ" ? subtotalInCurrency : null;
  return { unitPrice, currency: resolvedCurrency, subtotal, subtotalInCurrency, fromQuotation };
}

export function controlLineSubtotal(line: RadarLine): number | null {
  return controlLinePricing(line).subtotal;
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

export function buildConcreteControl(dispatch: RadarDispatch) {
  const lines = dispatch.guides.flatMap((guide) => guide.lines);
  const categories = groupControlLines(lines, controlLineCategory);
  const concreteLines = categories.get("concrete") ?? [];
  const otherLines = categories.get("other") ?? [];
  const otherProducts = otherLines.filter((line) => line.type === "PRODUCT");
  const otherServices = otherLines.filter((line) => line.type === "SERVICE");
  const pumpingLines = categories.get("pumping") ?? [];
  const warnings: string[] = [];
  const strengths = new Map<number | null, ConcreteStrength>();
  for (const [psi, group] of groupControlLines(concreteLines, concreteStrength)) {
    const quantity = controlRound(group.reduce((sum, line) => sum + line.quantity, 0));
    const subtotal = amount(group);
    const prices = new Set(group.filter((line) => line.quantity !== 0).map((line) => controlLinePricing(line).unitPrice));
    // Preserve a single recorded price. Different prices use the dispatched-volume weighted cost.
    const price = prices.size === 1 ? [...prices][0] : null;
    const unitPrice = quantity && subtotal.value !== null ? price ?? subtotal.value / quantity : null;
    strengths.set(psi, { quantity, unitPrice, amount: subtotal });
  }
  if (strengths.has(null)) warnings.push("Hay concreto sin resistencia PSI identificada; se incluye en el volumen y el subtotal.");
  if (concreteLines.some((line) => controlLinePricing(line).fromQuotation)) warnings.push("Se utilizó el precio de cotización del proyecto para concreto sin precio guardado.");
  const concreteVolume = controlRound(concreteLines.reduce((sum, line) => sum + line.quantity, 0));
  const pumpVolume = pumpingVolume(pumpingLines, warnings);
  const total = amount(lines);
  const emptyGuides = dispatch.guides.filter((guide) => !guide.lines.length).length;
  if (!dispatch.guides.length) warnings.push("Despacho sin guías registradas.");
  if (emptyGuides) warnings.push(`${emptyGuides} guía(s) sin líneas registradas.`);
  if (total.pending) warnings.push(`${total.pending} línea(s) con precio pendiente o moneda distinta de GTQ; total pendiente.`);
  const surcharge = amount(categories.get("surcharge") ?? []);
  const finishing = amount(categories.get("finishing") ?? []);
  const pumping = amount(pumpingLines);
  const otherService = amount(otherServices);
  const concrete = amount(concreteLines);
  const otherProduct = amount(otherProducts);
  return {
    hasLines: lines.length > 0,
    strengths, concreteVolume, concrete, otherProduct, product: addAmounts([concrete, otherProduct]),
    pumpingVolume: pumpVolume, pumping, surcharge, finishing, otherService,
    service: addAmounts([pumping, surcharge, finishing, otherService]),
    consumedVolume: pumpVolume === null ? null : controlRound((concreteVolume + pumpVolume) / 2),
    additionalLines: lines.filter((line) => !isConcreteVolume(line)),
    total, warnings,
  };
}

// Fixed separators avoid Intl whitespace differences between server and browser hydration.
export function controlNumber(value: number | null, decimals = 2) {
  if (value === null) return "Pendiente";
  const [whole, fraction] = value.toFixed(decimals).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${fraction ? `.${fraction}` : ""}`;
}
