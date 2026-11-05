// Informational fields belong to the guide, whether typed or read from a photo.
// They do not change the dispatch's project, order or programming.
export const GUIDE_FIELDS = {
  customerName: "Nombre del cliente", projectName: "Proyecto", workAddress: "Dirección de obra",
  guideDate: "Fecha", orderNumber: "Número de pedido", plant: "Planta", truck: "Camión",
  loadingTime: "Hora de carga", pilot: "Piloto", operator: "Operador", observations: "Observaciones",
} as const;
export type GuideField = keyof typeof GUIDE_FIELDS;
export type GuideDetails = Record<GuideField, string>;

export function emptyGuideDetails(): GuideDetails {
  return Object.fromEntries(Object.keys(GUIDE_FIELDS).map((key) => [key, ""])) as GuideDetails;
}

export function validateGuideDetails(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Revisa los campos de la guía.";
  const details = value as Record<string, unknown>;
  if (Object.keys(details).some((key) => !Object.hasOwn(GUIDE_FIELDS, key)) ||
      Object.entries(GUIDE_FIELDS).some(([key]) => typeof details[key] !== "string" ||
        (details[key] as string).length > (key === "observations" ? 4000 : 500))) {
    return "Revisa los campos de la guía y su longitud.";
  }
  if (details.loadingTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(details.loadingTime as string)) {
    return "Registra una hora de carga válida o déjala vacía.";
  }
  return null;
}
