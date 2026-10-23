// Physical quantities use the same three-decimal precision as real_volume.
export function guideTotalInput(total: number) {
  return String(Number(total.toFixed(3)));
}

export function initialRealVolumeOverride({
  realVolume,
  realUnitCode,
  programmedUnitCode,
  guideTotal,
  editable,
}: {
  realVolume: number | null;
  realUnitCode: string | null;
  programmedUnitCode: string;
  guideTotal: number;
  editable: boolean;
}): string | null {
  // Do not replace historical/readonly values or infer unit conversions.
  if (!editable || (realUnitCode !== null && realUnitCode !== programmedUnitCode)) {
    return realVolume === null ? "" : String(realVolume);
  }
  // A saved difference is an existing manual adjustment, not a missing value.
  if (realVolume !== null && Math.abs(realVolume - guideTotal) >= 0.0005) {
    return String(realVolume);
  }
  // null means automatic mode; an empty string is an intentional manual draft.
  return null;
}
