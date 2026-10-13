export type ReconciliationQuantitySource =
  | "REAL_VOLUME"
  | "PROGRAMMED_QUANTITY";

export type ReconciliationQuantityBasis = {
  quantity: number | null;
  unitCode: string | null;
  source: ReconciliationQuantitySource;
};

export function selectValidProgrammedQuantity(
  confirmed: number | null,
  requested: number | null,
): number | null {
  if (confirmed !== null && Number.isFinite(confirmed) && confirmed > 0) return confirmed;
  if (requested !== null && Number.isFinite(requested) && requested > 0) return requested;
  return null;
}

export function resolveReconciliationQuantityBasis(input: {
  dispatchResult: "DISPATCHED" | "NOT_DISPATCHED" | null;
  incidentCount: number;
  realVolume: number | null;
  realUnitCode: string | null;
  programmedQuantity: number | null;
  programmedUnitCode: string | null;
}): ReconciliationQuantityBasis {
  const useProgrammedQuantity =
    input.dispatchResult === "NOT_DISPATCHED" && input.incidentCount > 0;

  return useProgrammedQuantity
    ? {
        quantity: input.programmedQuantity !== null && input.programmedQuantity > 0
          && input.programmedUnitCode?.trim() ? input.programmedQuantity : null,
        unitCode: input.programmedUnitCode?.trim() || null,
        source: "PROGRAMMED_QUANTITY",
      }
    : {
        quantity: input.realVolume,
        unitCode: input.realUnitCode,
        source: "REAL_VOLUME",
      };
}
