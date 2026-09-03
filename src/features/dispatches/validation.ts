import type { DispatchResult } from "./types";

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
  arrivalAt: string | null;
  departureAt: string | null;
  orderNumber: string | null;
  realVolume: number | null;
  realUnitCode: string | null;
}) {
  if (!input.result) return false;
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
