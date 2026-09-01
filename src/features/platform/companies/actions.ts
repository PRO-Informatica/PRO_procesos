"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createClient } from "@/lib/supabase/server";

import type { CompanyActionState, ProjectSuppliersActionState } from "./types";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function actionError(message: string, fields?: CompanyActionState["fields"]) {
  return { status: "error" as const, message, fields };
}

function databaseErrorMessage(error: { code?: string; message: string }) {
  const normalizedMessage = error.message.toUpperCase();

  if (normalizedMessage.includes("PERMISSION_DENIED")) {
    return "No tienes autorización para realizar esta acción.";
  }

  if (normalizedMessage.includes("COMPANY_NOT_FOUND")) {
    return "La empresa ya no existe o no está disponible.";
  }

  if (
    error.code === "23505" ||
    normalizedMessage.includes("DUPLICATE") ||
    normalizedMessage.includes("UNIQUE")
  ) {
    return "Ya existe una empresa con ese código. Utiliza un código diferente.";
  }

  return "No fue posible completar la operación. Intenta nuevamente.";
}

async function authorizePlatformAction() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId || !(await isPlatformAdmin(userId))) {
    return null;
  }

  return supabase;
}

export async function createCompany(
  _previousState: CompanyActionState,
  formData: FormData,
): Promise<CompanyActionState> {
  const name = readText(formData, "name");
  const code = readText(formData, "code");
  const fields = { name, code };

  if (!name || !code) {
    return actionError("Completa el nombre y el código de la empresa.", fields);
  }

  if (name.length < 2 || name.length > 160) {
    return actionError("El nombre debe tener entre 2 y 160 caracteres.", fields);
  }

  if (code.length > 40) {
    return actionError("El código no puede exceder 40 caracteres.", fields);
  }

  const supabase = await authorizePlatformAction();
  if (!supabase) {
    return actionError("No tienes autorización para crear empresas.", fields);
  }

  const { data, error } = await supabase.rpc("platform_create_company", {
    p_name: name,
    p_code: code,
  });

  if (error) {
    return actionError(databaseErrorMessage(error), fields);
  }

  if (typeof data !== "string" || !/^[0-9a-f-]{36}$/i.test(data)) {
    return actionError(
      "La empresa fue procesada, pero no recibimos un identificador válido.",
      fields,
    );
  }

  revalidatePath("/platform/companies");
  redirect(`/platform/companies/${data}`);
}

export async function setCompanyStatus(
  _previousState: CompanyActionState,
  formData: FormData,
): Promise<CompanyActionState> {
  const companyId = readText(formData, "companyId");
  const activeValue = readText(formData, "active");
  const returnTo = readText(formData, "returnTo");

  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !["true", "false"].includes(activeValue)) {
    return actionError("La solicitud de cambio de estado no es válida.");
  }

  const supabase = await authorizePlatformAction();
  if (!supabase) {
    return actionError("No tienes autorización para cambiar el estado de empresas.");
  }

  const { error } = await supabase.rpc("platform_set_company_status", {
    p_company_id: companyId,
    p_active: activeValue === "true",
  });

  if (error) {
    return actionError(databaseErrorMessage(error));
  }

  revalidatePath("/platform/companies");
  revalidatePath(`/platform/companies/${companyId}`);

  const safeReturnTo =
    returnTo === "/platform/companies" ||
    returnTo.startsWith("/platform/companies?") ||
    returnTo === `/platform/companies/${companyId}`
      ? returnTo
      : "/platform/companies";
  redirect(safeReturnTo);
}

export async function setProjectSuppliers(
  _previousState: ProjectSuppliersActionState,
  formData: FormData,
): Promise<ProjectSuppliersActionState> {
  const companyId = readText(formData, "companyId");
  const projectId = readText(formData, "projectId");
  const supplierIds = [
    ...new Set(
      formData
        .getAll("supplierIds")
        .filter((value): value is string => typeof value === "string" && isUuid(value)),
    ),
  ];

  if (!isUuid(companyId) || !isUuid(projectId)) {
    return actionError(
      "La empresa o el proyecto seleccionado no es válido.",
    );
  }

  const supabase = await authorizePlatformAction();
  if (!supabase) {
    return actionError("No tienes autorización para asignar proveedores.");
  }

  const { data, error } = await supabase.rpc("platform_set_project_suppliers", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_supplier_ids: supplierIds,
  });

  if (error) {
    const message = error.message.toUpperCase();
    if (message.includes("PROJECT_SUPPLIER_INVALID")) {
      return actionError(
        "Uno de los proveedores no está activo o no pertenece a esta empresa.",
      );
    }
    if (message.includes("PROJECT_COMPANY_MISMATCH")) {
      return actionError("El proyecto no pertenece a esta empresa.");
    }
    return actionError(databaseErrorMessage(error));
  }

  revalidatePath(`/platform/companies/${companyId}`);
  revalidatePath("/programming");

  return {
    status: "success",
    message: `${Number(data ?? supplierIds.length)} proveedor(es) activos guardados.`,
  };
}
