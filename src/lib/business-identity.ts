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
