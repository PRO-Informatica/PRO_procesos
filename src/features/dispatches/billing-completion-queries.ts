import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getDispatchBillingCompletion(projectIds: string[]): Promise<Record<string, boolean>> {
  if (!projectIds.length) return {};
  const { data, error } = await (await createClient()).rpc("get_dispatch_billing_completion", {
    p_project_ids: [...new Set(projectIds)],
  });
  if (error) {
    throw new Error(`No fue posible verificar la conciliación de Producto y Servicio de los despachos (${error.code ?? "RPC_ERROR"}).`, { cause: error });
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.values(data).some((value) => typeof value !== "boolean")) {
    throw new Error("No fue posible verificar la conciliación de Producto y Servicio de los despachos.");
  }
  return data as Record<string, boolean>;
}
