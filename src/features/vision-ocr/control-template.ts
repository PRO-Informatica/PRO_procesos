import { normalizeOcrText } from "./guide-parser.ts";

// Match the document family before looking at the supplier. These aliases are
// also used to locate the heading in Vision's word coordinates.
export const CONTROL_HEADINGS = [
  "PEDIDO CONTROL DE OPERACIONES", "PEDIDO CONTROL DE OPERACION",
  "PEDIDO CONTROL OPERACIONES", "PEDIDO CONTROL OPERACION",
  "CONTROL DE OPERACIONES", "CONTROL DE OPERACION",
  "CONTROL OPERACIONES", "CONTROL OPERACION",
  "CONTROL DE PEDIDOS", "CONTROL DE PEDIDO", "CONTROL PEDIDOS", "CONTROL PEDIDO",
  "PEDIDO DE CONTROL", "PEDIDOS DE CONTROL",
] as const;

export function hasControlHeading(text: string) {
  const normalized = ` ${normalizeOcrText(text)} `;
  return CONTROL_HEADINGS.some((heading) => normalized.includes(` ${heading} `));
}
