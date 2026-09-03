import { normalizeBusinessIdentity } from "../../lib/business-identity.ts";

export const MIXTO_PROJECT_BILLING_NAME_MISSING_ERROR =
  "El proyecto seleccionado no tiene configurada su Razón Social de facturación. Configure los datos fiscales del proyecto antes de cargar programaciones.";

export const MIXTO_PROJECT_REFERENCE_MISSING_ERROR =
  'No fue posible identificar el proyecto en la solicitud de concreto. Verifique el campo "Nombre destinatario de factura".';

export const MIXTO_PROJECT_MISMATCH_ERROR =
  "El archivo cargado corresponde a un proyecto diferente al proyecto seleccionado actualmente.";

export function mixtoProjectMismatchMessage(
  billingLegalName: string,
  invoiceRecipient: string,
) {
  return `${MIXTO_PROJECT_MISMATCH_ERROR} Razón Social esperada: "${billingLegalName.trim()}". Nombre destinatario de factura encontrado: "${invoiceRecipient.trim()}".`;
}

export function assertMixtoProjectReference(
  billingLegalName: string,
  invoiceRecipient: string,
) {
  const normalizedProject = normalizeBusinessIdentity(billingLegalName);
  if (!normalizedProject) {
    throw new Error(MIXTO_PROJECT_BILLING_NAME_MISSING_ERROR);
  }

  const normalizedRecipient = normalizeBusinessIdentity(invoiceRecipient);
  if (!normalizedRecipient) throw new Error(MIXTO_PROJECT_REFERENCE_MISSING_ERROR);

  if (normalizedProject !== normalizedRecipient) {
    throw new Error(
      mixtoProjectMismatchMessage(billingLegalName, invoiceRecipient),
    );
  }
}
