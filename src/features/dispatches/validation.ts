import type { DispatchCatalogType, DispatchResult } from "./types";

export const DISPATCH_GUIDE_UNIT_CODES = ["KM", "M3", "UN"] as const;

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

export function validateDispatchGuideLines(lines: DispatchGuideLineInput[]) {
  if (
    !lines.length ||
    lines.some(
      (line) =>
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0 ||
        !DISPATCH_GUIDE_UNIT_CODES.includes(
          line.unit_code as (typeof DISPATCH_GUIDE_UNIT_CODES)[number],
        ),
    )
  ) {
    return "Cada línea necesita una cantidad mayor que cero y una UM válida.";
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
    return "Selecciona un producto o servicio del catálogo en cada línea nueva.";
  }

  return null;
}
