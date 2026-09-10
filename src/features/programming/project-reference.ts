import { normalizeBusinessIdentity } from "../../lib/business-identity.ts";
import {
  compareAddresses,
  resolveAddressCandidates,
  type AddressComparison,
} from "../../lib/address-identity.ts";

export const MIXTO_PROJECT_BILLING_NAME_MISSING_ERROR =
  "El proyecto seleccionado no tiene configurada su Razón Social de facturación. Configure los datos fiscales del proyecto antes de cargar programaciones.";

export const MIXTO_PROJECT_REFERENCE_MISSING_ERROR =
  'No fue posible identificar el proyecto en la solicitud de concreto. Verifique el campo "Nombre destinatario de factura".';

export const MIXTO_PROJECT_MISMATCH_ERROR =
  "El archivo cargado corresponde a un proyecto diferente al proyecto seleccionado actualmente.";

export const MIXTO_PROJECT_ADDRESS_MISSING_ERROR =
  "El proyecto seleccionado no tiene configurada su Dirección exacta de Obra.";

export const MIXTO_WORKBOOK_ADDRESS_MISSING_ERROR =
  'No fue posible identificar el proyecto en la solicitud. Verifique el campo "Dirección exacta de Obra".';

export const MIXTO_PROJECT_ADDRESS_MISMATCH_ERROR =
  "La Dirección exacta de Obra del archivo no corresponde al proyecto seleccionado.";

export const MIXTO_PROJECT_ADDRESS_REVIEW_ERROR =
  "La dirección del archivo se parece a la del proyecto, pero requiere revisión antes de asociarse.";

export const MIXTO_PROJECT_ADDRESS_AMBIGUOUS_ERROR =
  "La dirección del archivo puede corresponder a más de un proyecto autorizado.";

export type MixtoProjectAddressCandidate = {
  id: string;
  label: string;
  address: string;
  billingLegalName: string | null;
};

function comparisonDetails(comparison: AddressComparison) {
  return comparison.differences.length
    ? comparison.differences.join(" ")
    : "No se detectaron diferencias relevantes en los componentes de la dirección.";
}

function tolerantAddressWarning(input: {
  projectLabel?: string;
  projectAddress: string;
  workbookAddress: string;
  comparison: AddressComparison;
}) {
  return [
    input.comparison.warnings[0],
    input.projectLabel ? `Proyecto: ${input.projectLabel}.` : null,
    `Dirección configurada: "${input.projectAddress.trim()}".`,
    `Dirección detectada: "${input.workbookAddress.trim()}".`,
    comparisonDetails(input.comparison),
  ].filter(Boolean).join(" ");
}

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

export function validateMixtoProjectReference(input: {
  projectId?: string;
  projectLabel?: string;
  projectAddress: string;
  workbookAddress: string;
  billingLegalName: string;
  invoiceRecipient: string;
  candidateProjects?: MixtoProjectAddressCandidate[];
}) {
  if (!input.projectAddress.trim()) throw new Error(MIXTO_PROJECT_ADDRESS_MISSING_ERROR);
  if (!input.workbookAddress.trim()) throw new Error(MIXTO_WORKBOOK_ADDRESS_MISSING_ERROR);

  const expectedName = normalizeBusinessIdentity(input.billingLegalName);
  const actualName = normalizeBusinessIdentity(input.invoiceRecipient);
  const billingNameMatches = Boolean(expectedName && actualName && expectedName === actualName);
  const comparison = compareAddresses(input.projectAddress, input.workbookAddress);
  const candidates = input.candidateProjects ?? [];
  const candidateResolution = candidates.length
    ? resolveAddressCandidates(
        input.workbookAddress,
        candidates.map((candidate) => ({ id: candidate.id, address: candidate.address })),
      )
    : null;
  const exactBillingCandidates = candidateResolution?.candidates.filter(({ id }) => {
    const candidate = candidates.find((project) => project.id === id);
    return candidate &&
      normalizeBusinessIdentity(candidate.billingLegalName) === actualName;
  }) ?? [];
  const resolvedCandidateId = candidateResolution?.result === "MATCH"
    ? candidateResolution.selectedId
    : exactBillingCandidates.length === 1
      ? exactBillingCandidates[0].id
      : null;

  if (
    candidateResolution?.result === "REQUIRES_REVIEW" &&
    !resolvedCandidateId
  ) {
    const labels = candidateResolution.candidates
      .map(({ id }) => candidates.find((candidate) => candidate.id === id)?.label)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `${MIXTO_PROJECT_ADDRESS_AMBIGUOUS_ERROR} Candidatos: ${labels || "sin identificar"}. Dirección detectada: "${input.workbookAddress.trim()}".`,
    );
  }
  if (resolvedCandidateId && input.projectId && resolvedCandidateId !== input.projectId) {
    const candidate = candidates.find(({ id }) => id === resolvedCandidateId);
    throw new Error(
      `${MIXTO_PROJECT_MISMATCH_ERROR} La dirección detectada corresponde a ${candidate?.label ?? "otro proyecto autorizado"}.`,
    );
  }
  if (comparison.result === "NO_MATCH") {
    const alternative = candidateResolution?.candidates[0];
    const candidate = candidates.find(({ id }) => id === alternative?.id);
    throw new Error(
      `${MIXTO_PROJECT_ADDRESS_MISMATCH_ERROR}${candidate ? ` Posible proyecto: ${candidate.label}.` : ""} ${comparisonDetails(comparison)}`,
    );
  }
  if (comparison.result === "REQUIRES_REVIEW" && !billingNameMatches) {
    throw new Error(
      `${MIXTO_PROJECT_ADDRESS_REVIEW_ERROR} Dirección configurada: "${input.projectAddress.trim()}". Dirección detectada: "${input.workbookAddress.trim()}". ${comparisonDetails(comparison)}`,
    );
  }

  const warnings: string[] = [];
  if (comparison.matchMethod !== "EXACT") {
    warnings.push(tolerantAddressWarning({
      projectLabel: input.projectLabel,
      projectAddress: input.projectAddress,
      workbookAddress: input.workbookAddress,
      comparison,
    }));
  }
  if (expectedName && actualName && expectedName !== actualName) {
    warnings.push(
      "La dirección corresponde al proyecto, pero el destinatario de factura es diferente.",
    );
  }
  return {
    comparison,
    warnings,
    warning: warnings[0] ?? null,
  };
}
