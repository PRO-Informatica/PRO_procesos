import { commitUniversalInvoice } from "@/features/invoices/universal/service";
import { hasValidSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) return Response.json({ message: "Solicitud no válida." }, { status: 403 });
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return Response.json({ message: "Selecciona un PDF." }, { status: 400 });
    return Response.json(await commitUniversalInvoice(file, {
      projectId: typeof formData.get("projectId") === "string" ? String(formData.get("projectId")) : null,
      dispatchId: typeof formData.get("dispatchId") === "string" ? String(formData.get("dispatchId")) : null,
    }));
  } catch (error) {
    console.error("Universal invoice commit failed", error);
    return Response.json({ message: "No fue posible procesar la factura." }, { status: 500 });
  }
}
