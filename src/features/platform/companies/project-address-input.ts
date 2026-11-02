import { normalizeAddressIdentity } from "../../../lib/address-identity.ts";

export function validateProjectAddressInput(address: string, additionalAddresses: readonly string[]) {
  const addresses = [address, ...additionalAddresses].map((value) => value.trim());
  if (addresses.some((value) => value.length < 5 || value.length > 300)) {
    return "Cada dirección de la obra debe tener entre 5 y 300 caracteres.";
  }
  const normalized = addresses.map(normalizeAddressIdentity);
  if (normalized.some((value) => !value)) return "Indica una dirección válida para la obra.";
  if (new Set(normalized).size !== normalized.length) return "Hay direcciones repetidas. Conserva una sola vez cada dirección de la obra.";
  return null;
}
