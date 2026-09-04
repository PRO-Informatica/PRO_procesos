export function normalizeBusinessIdentity(
  value: string | null | undefined,
) {
  if (!value?.trim()) return null;

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/SOCIEDADANONIMA/g, "SA");
}

export function normalizeTaxIdentity(value: string | null | undefined) {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

export function matchesFiscalIdentity(input: {
  expectedName: string | null | undefined;
  actualName: string | null | undefined;
  expectedTaxId?: string | null;
  actualTaxId?: string | null;
}) {
  const expectedName = normalizeBusinessIdentity(input.expectedName);
  const actualName = normalizeBusinessIdentity(input.actualName);
  if (!expectedName || expectedName !== actualName) return false;

  const expectedTaxId = normalizeTaxIdentity(input.expectedTaxId);
  const actualTaxId = normalizeTaxIdentity(input.actualTaxId);
  return !expectedTaxId || !actualTaxId || expectedTaxId === actualTaxId;
}
