import { decideInvoiceRecipientException, type RecipientExceptionDecision } from "@/features/invoices/recipient-exception-service";
import { hasValidSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) {
    return Response.json({ message: "Solicitud no válida." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const result = await decideInvoiceRecipientException(
      typeof body.projectId === "string" ? body.projectId : "",
      typeof body.invoiceId === "string" ? body.invoiceId : "",
      body.decision as RecipientExceptionDecision,
    );
    return Response.json(result, { status: result.status === "success" ? 200 : 400 });
  } catch (error) {
    console.error("Invoice recipient exception decision failed", error);
    return Response.json({ message: "No fue posible registrar la decisión." }, { status: 500 });
  }
}
