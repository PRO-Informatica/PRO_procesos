// Slump is a quoted range/tolerance in inches, not necessarily a single number.
export function productSpecifications(psi: string, rawSlump: string) {
  const normalized = psi.trim().replace(/\s*PSI$/iu, "").replace(/^(\d{1,2})[, .](\d{3})$/u, "$1$2");
  const resistancePsi = normalized ? Number(normalized) : null;
  const slump = rawSlump.trim() || null;
  if (normalized && (!/^\d{1,5}$/u.test(normalized) || !Number.isInteger(resistancePsi) || resistancePsi! <= 0)) {
    return { resistancePsi: null, slump, error: "La resistencia PSI debe ser un entero entre 1 y 99999 o quedar vacía." };
  }
  if (slump && (slump.length > 120 || /[\u0000-\u001f\u007f]/u.test(slump))) {
    return { resistancePsi, slump, error: "El slump debe tener hasta 120 caracteres, en una sola línea." };
  }
  return { resistancePsi, slump, error: null };
}
