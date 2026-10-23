export const DELIVERY_MODES = ["DIRECT", "PUMP", "BOOM", "PLACEMENT"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  DIRECT: "Concreto directo",
  PUMP: "Bomba",
  BOOM: "Pluma",
  PLACEMENT: "Colocación",
};

export function isDeliveryMode(value: string): value is DeliveryMode {
  return DELIVERY_MODES.includes(value as DeliveryMode);
}

// Missing historical data is NOT evidence of direct delivery. Only an explicit,
// exclusive DIRECT mark makes the service invoice optional for completion.
export function requiresServiceInvoice(modes: readonly string[] | null | undefined) {
  return !(modes?.length === 1 && modes[0] === "DIRECT");
}

export function deliveryModeLabel(modes: readonly DeliveryMode[]) {
  return modes.length
    ? modes.map((mode) => DELIVERY_MODE_LABELS[mode]).join(" / ")
    : "Sin especificar";
}
