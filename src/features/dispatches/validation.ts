import type { DispatchCatalogType, DispatchResult } from "./types";
import { SERVICE_UNIT_CODES } from "../platform/project-price-catalogs/service-units.ts";

export const DISPATCH_GUIDE_UNIT_CODES = ["KM", "M3", "UN"] as const;

export function validateGuideTruckTimes(arrival: string, departure: string) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(arrival) || !time.test(departure)) {
    return "Registra una hora de llegada y una hora de salida válidas para el camión.";
  }
  return null;
}

export type DispatchGuideLineInput = {
  line_id: string | null;
  quantity: number;
  unit_code: string;
  catalog_type: DispatchCatalogType | null;
  catalog_item_id: string | null;
  product_description: string | null;
};

export function totalGuideVolume(guides: Array<{ quantity: number }>) {
  return guides.reduce((total, guide) => total + guide.quantity, 0);
}

export function realVolumeWarning(total: number, real: number | null) {
  if (real === null || Math.abs(total - real) < 0.0005) return null;
  return "El Volumen Real ingresado no coincide con el total registrado en las guías. Verifique la información antes de finalizar el despacho.";
}

export function canCompleteDispatch(input: {
  result: DispatchResult | null;
  guideCount: number;
  incidentCount: number;
  evidenceCount: number;
  arrivalAt: string | null;
  departureAt: string | null;
  orderNumber: string | null;
  realVolume: number | null;
  realUnitCode: string | null;
}) {
  if (!input.result || input.evidenceCount < 1) return false;
  if (input.result === "NOT_DISPATCHED") {
    return input.incidentCount > 0 && input.realVolume === 0;
  }
  return Boolean(
    input.guideCount > 0 &&
      input.arrivalAt &&
      input.departureAt &&
      input.orderNumber?.trim() &&
      input.realVolume !== null &&
      input.realVolume > 0 &&
      input.realUnitCode,
  );
}

export function guideLineQuantityError(quantity: number, documentType?: string) {
  const minimum = documentType === "DISPATCH_GUIDE" ? 0 : 0.001;
  if (Number.isFinite(quantity) && quantity >= minimum && quantity < 1_000_000_000 &&
    (quantity === 0 || quantity >= 0.001) &&
    Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 0.00001) return null;
  return minimum === 0
    ? "Ingresa una cantidad de cero o más, con hasta tres decimales."
    : "Los controles de operación requieren una cantidad mayor que cero, con hasta tres decimales.";
}

export function validateDispatchGuideLines(lines: DispatchGuideLineInput[], documentType = "DISPATCH_GUIDE") {
  if (!lines.length) return "Agrega al menos una línea a la guía.";
  for (const line of lines) {
    const error = guideLineQuantityError(line.quantity, documentType);
    if (error) return error;
  }
  if (
    lines.some(
      (line) =>
        (line.unit_code !== "" && !(line.catalog_type === "SERVICE" ? SERVICE_UNIT_CODES as readonly string[] : DISPATCH_GUIDE_UNIT_CODES as readonly string[]).includes(
          line.unit_code,
        )),
    )
  ) {
    return "La UM es opcional. Si la indicas, usa una UM válida.";
  }

  if (
    lines.some(
      (line) =>
        (line.product_description?.length ?? 0) > 500,
    )
  ) {
    return "Revisa la longitud de la descripción.";
  }

  if (
    lines.some((line) => {
      if (!line.catalog_type) return !line.line_id;
      return !line.catalog_item_id && !line.line_id;
    })
  ) {
    return "Selecciona un producto o servicio de la cotización en cada línea nueva.";
  }

  return null;
}
