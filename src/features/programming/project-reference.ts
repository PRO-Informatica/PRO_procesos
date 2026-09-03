export const MIXTO_PROJECT_CODE_MISSING_ERROR =
  "El proyecto seleccionado no tiene configurado un código para validar la solicitud de Mixto Listo.";

export const MIXTO_PROJECT_REFERENCE_MISSING_ERROR =
  'No fue posible identificar el proyecto en la solicitud de concreto. Verifique el campo "Nombre destinatario de factura".';

export const MIXTO_PROJECT_MISMATCH_ERROR =
  "El archivo cargado corresponde a un proyecto diferente al proyecto seleccionado actualmente.";

export function mixtoProjectMismatchMessage(
  projectCode: string,
  invoiceRecipient: string,
) {
  return `${MIXTO_PROJECT_MISMATCH_ERROR} Código esperado: "${projectCode.trim()}". Nombre destinatario de factura encontrado: "${invoiceRecipient.trim()}".`;
}

export function normalizeProjectReference(value: string) {
  const tokens = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bSOCIEDAD\s+ANONIMA\b/g, " SA ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const normalizedTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "S" && tokens[index + 1] === "A") {
      normalizedTokens.push("SA");
      index += 1;
    } else {
      normalizedTokens.push(tokens[index]);
    }
  }
  return normalizedTokens.join(" ");
}

export function assertMixtoProjectReference(
  projectCode: string,
  invoiceRecipient: string,
) {
  const normalizedProject = normalizeProjectReference(projectCode);
  if (!normalizedProject) throw new Error(MIXTO_PROJECT_CODE_MISSING_ERROR);

  const normalizedRecipient = normalizeProjectReference(invoiceRecipient);
  if (!normalizedRecipient) throw new Error(MIXTO_PROJECT_REFERENCE_MISSING_ERROR);

  if (normalizedProject !== normalizedRecipient) {
    throw new Error(mixtoProjectMismatchMessage(projectCode, invoiceRecipient));
  }
}
