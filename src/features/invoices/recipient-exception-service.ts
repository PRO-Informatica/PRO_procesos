import "server-only";

import { requireActiveProfile } from "@/features/auth/queries";
import { getOperationalProjectAccessForProject } from "@/features/projects/queries";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RecipientExceptionDecision = "APPROVE" | "REQUEST_REINVOICE";

export type RecipientExceptionDecisionResult = {
  status: "success" | "error";
  message: string;
  exceptionStatus?: "APPROVED" | "REINVOICE_REQUESTED";
  reconciliationStatus?: string;
};

function decisionError(message: string) {
  const normalized = message.toUpperCase();
  if (normalized.includes("EXCEPTION_NOT_FOUND")) return "No se encontró una excepción pendiente para esta factura.";
  if (normalized.includes("ALREADY_DECIDED")) return "Esta excepción ya fue resuelta.";
  if (normalized.includes("PERMISSION_DENIED")) return "No tienes permiso para decidir esta excepción.";
  if (normalized.includes("DECISION_INVALID")) return "La decisión seleccionada no es válida.";
  return "No fue posible registrar la decisión sobre C14.";
}

export async function decideInvoiceRecipientException(
  projectId: string,
  invoiceId: string,
  decision: RecipientExceptionDecision,
): Promise<RecipientExceptionDecisionResult> {
  if (!UUID.test(projectId) || !UUID.test(invoiceId) || !["APPROVE", "REQUEST_REINVOICE"].includes(decision)) {
    return { status: "error", message: "La solicitud no es válida." };
  }

  const profile = await requireActiveProfile();
  const scope = await getOperationalProjectAccessForProject(profile.id, projectId);
  if (!scope?.permissions.includes("invoice.review")) {
    return { status: "error", message: "No tienes permiso para decidir esta excepción." };
  }

  const { data, error } = await (await createClient()).rpc("decide_invoice_recipient_exception", {
    p_invoice_id: invoiceId,
    p_decision: decision,
  });
  const row = data?.[0];
  if (error || !row) {
    return { status: "error", message: decisionError(error?.message ?? "EXCEPTION_DECISION_FAILED") };
  }

  return {
    status: "success",
    message: decision === "APPROVE"
      ? "Excepción aceptada. La factura continuó con su flujo normal."
      : "Refacturación solicitada. La factura original quedó en el historial.",
    exceptionStatus: String(row.exception_status) as "APPROVED" | "REINVOICE_REQUESTED",
    reconciliationStatus: row.reconciliation_status ? String(row.reconciliation_status) : undefined,
  };
}
