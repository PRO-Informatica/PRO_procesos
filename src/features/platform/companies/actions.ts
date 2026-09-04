"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createClient } from "@/lib/supabase/server";

import type {
  CompanyActionState,
  ProjectActionState,
  ProjectSuppliersActionState,
} from "./types";

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

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidProjectCode(value: string) {
  return (
    value.length >= 2 &&
    value.length <= 40 &&
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

export async function createCompanyProject(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const companyId = readText(formData, "companyId");
  const name = readText(formData, "name");
  const code = readText(formData, "code").toUpperCase();
  const address = readText(formData, "address");
  const timezone = readText(formData, "timezone") || "America/Guatemala";
  const startDate = readText(formData, "startDate");
  const estimatedEndDate = readText(formData, "estimatedEndDate");
  const billingLegalName = readText(formData, "billingLegalName");
  const billingTaxId = readText(formData, "billingTaxId");
  const fields = { name, code, address, timezone, startDate, estimatedEndDate, billingLegalName, billingTaxId };

  if (!isUuid(companyId)) {
    return {
      status: "error",
      message: "La empresa seleccionada no es válida.",
      fields,
    };
  }
  if (name.length < 2 || name.length > 160) {
    return {
      status: "error",
      message: "El nombre debe tener entre 2 y 160 caracteres.",
      fields,
    };
  }
  if (!isValidProjectCode(code)) {
    return {
      status: "error",
      message: "El código debe tener entre 2 y 40 caracteres.",
      fields,
    };
  }
  if (address.length > 300) {
    return {
      status: "error",
      message: "La dirección no puede exceder 300 caracteres.",
      fields,
    };
  }
  if (!isValidTimezone(timezone)) {
    return {
      status: "error",
      message: "Selecciona una zona horaria válida.",
      fields,
    };
  }
  if (startDate && estimatedEndDate && estimatedEndDate < startDate) {
    return {
      status: "error",
      message:
        "La fecha estimada de finalización no puede ser anterior al inicio.",
      fields,
    };
  }
  if (billingLegalName.length < 2 || billingLegalName.length > 200) {
    return { status: "error", message: "La razón social de facturación es obligatoria y debe tener entre 2 y 200 caracteres.", fields };
  }
  if (billingTaxId.replace(/[^0-9A-Za-z]/g, "").length < 3) {
    return { status: "error", message: "El NIT receptor es obligatorio.", fields };
  }

  const supabase = await authorizePlatformAction();
  if (!supabase) {
    return {
      status: "error",
      message: "No tienes autorización para crear proyectos.",
      fields,
    };
  }

  const { data, error } = await supabase.rpc(
    "platform_create_company_project",
    {
      p_company_id: companyId,
      p_name: name,
      p_code: code,
      p_address: address || null,
      p_timezone: timezone,
      p_start_date: startDate || null,
      p_estimated_end_date: estimatedEndDate || null,
    },
  );

  if (error) {
    const value = error.message.toUpperCase();
    if (value.includes("PROJECT_CODE_ALREADY_EXISTS")) {
      return {
        status: "error",
        message: "Ya existe un proyecto con ese código.",
        fields,
      };
    }
    if (value.includes("PROJECT_CODE_INVALID")) {
      return {
        status: "error",
        message: "El código debe tener entre 2 y 40 caracteres.",
        fields,
      };
    }
    if (value.includes("ACTIVE_COMPANY_NOT_FOUND")) {
      return {
        status: "error",
        message: "La empresa no existe o está inactiva.",
        fields,
      };
    }
    if (value.includes("PROJECT_TIMEZONE_INVALID")) {
      return {
        status: "error",
        message: "La zona horaria seleccionada no es válida.",
        fields,
      };
    }
    if (value.includes("PROJECT_DATE_RANGE_INVALID")) {
      return {
        status: "error",
        message:
          "La fecha estimada de finalización no puede ser anterior al inicio.",
        fields,
      };
    }
    if (value.includes("PERMISSION_DENIED")) {
      return {
        status: "error",
        message: "No tienes autorización para crear proyectos.",
        fields,
      };
    }
    return {
      status: "error",
      message: "No fue posible crear el proyecto.",
      fields,
    };
  }

  revalidatePath("/platform/companies");
  revalidatePath(`/platform/companies/${companyId}`);
  if (typeof data !== "string" || !isUuid(data)) {
    return {
      status: "error",
      message:
        "El proyecto fue creado, pero no recibimos un identificador válido.",
    };
  }
  const billingResult = await supabase.rpc("platform_update_project_billing_identity", {
    p_company_id: companyId,
    p_project_id: data,
    p_billing_legal_name: billingLegalName,
    p_billing_tax_id: billingTaxId,
  });
  if (billingResult.error) {
    return { status: "error", message: "El proyecto se creó, pero no fue posible guardar su identidad fiscal.", fields };
  }
  redirect(`/platform/companies/${companyId}`);
}

export async function updateCompanyProject(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const companyId = readText(formData, "companyId");
  const projectId = readText(formData, "projectId");
  const name = readText(formData, "name");
  const code = readText(formData, "code").toUpperCase();
  const address = readText(formData, "address");
  const timezone = readText(formData, "timezone") || "America/Guatemala";
  const status = readText(formData, "status").toUpperCase();
  const startDate = readText(formData, "startDate");
  const estimatedEndDate = readText(formData, "estimatedEndDate");
  const billingLegalName = readText(formData, "billingLegalName");
  const billingTaxId = readText(formData, "billingTaxId");
  const fields = {
    name,
    code,
    address,
    timezone,
    status,
    startDate,
    estimatedEndDate,
    billingLegalName,
    billingTaxId,
  };

  if (!isUuid(companyId) || !isUuid(projectId)) {
    return { status: "error", message: "El proyecto seleccionado no es válido.", fields };
  }
  if (name.length < 2 || name.length > 160) {
    return {
      status: "error",
      message: "El nombre debe tener entre 2 y 160 caracteres.",
      fields,
    };
  }
  if (!isValidProjectCode(code)) {
    return {
      status: "error",
      message: "El código debe tener entre 2 y 40 caracteres.",
      fields,
    };
  }
  if (address.length > 300) {
    return {
      status: "error",
      message: "La dirección no puede exceder 300 caracteres.",
      fields,
    };
  }
  if (!isValidTimezone(timezone)) {
    return { status: "error", message: "Selecciona una zona horaria válida.", fields };
  }
  if (!["ACTIVE", "INACTIVE", "CLOSED"].includes(status)) {
    return { status: "error", message: "Selecciona un estado válido.", fields };
  }
  if (startDate && estimatedEndDate && estimatedEndDate < startDate) {
    return {
      status: "error",
      message: "La fecha estimada de finalización no puede ser anterior al inicio.",
      fields,
    };
  }
  if (billingLegalName.length < 2 || billingLegalName.length > 200) {
    return { status: "error", message: "La razón social de facturación es obligatoria y debe tener entre 2 y 200 caracteres.", fields };
  }
  if (billingTaxId.replace(/[^0-9A-Za-z]/g, "").length < 3) {
    return { status: "error", message: "El NIT receptor es obligatorio.", fields };
  }

  const supabase = await authorizePlatformAction();
  if (!supabase) {
    return {
      status: "error",
      message: "No tienes autorización para editar proyectos.",
      fields,
    };
  }

  const { data, error } = await supabase.rpc("platform_update_company_project", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_name: name,
    p_code: code,
    p_address: address || null,
    p_timezone: timezone,
    p_status: status,
    p_start_date: startDate || null,
    p_estimated_end_date: estimatedEndDate || null,
  });

  if (error) {
    const value = error.message.toUpperCase();
    if (value.includes("PROJECT_CODE_ALREADY_EXISTS")) {
      return { status: "error", message: "Ya existe un proyecto con ese código.", fields };
    }
    if (value.includes("PROJECT_CODE_INVALID")) {
      return {
        status: "error",
        message: "El código debe tener entre 2 y 40 caracteres.",
        fields,
      };
    }
    if (value.includes("PROJECT_NOT_FOUND") || value.includes("PROJECT_COMPANY_MISMATCH")) {
      return {
        status: "error",
        message: "El proyecto ya no existe o no pertenece a esta empresa.",
        fields,
      };
    }
    if (value.includes("PROJECT_TIMEZONE_INVALID")) {
      return { status: "error", message: "La zona horaria no es válida.", fields };
    }
    if (value.includes("PROJECT_DATE_RANGE_INVALID")) {
      return {
        status: "error",
        message: "La fecha estimada de finalización no puede ser anterior al inicio.",
        fields,
      };
    }
    if (value.includes("PERMISSION_DENIED")) {
      return {
        status: "error",
        message: "No tienes autorización para editar proyectos.",
        fields,
      };
    }
    return { status: "error", message: "No fue posible actualizar el proyecto.", fields };
  }

  if (typeof data !== "string" || data !== projectId) {
    return {
      status: "error",
      message: "El proyecto fue actualizado, pero no recibimos una confirmación válida.",
    };
  }

  const billingResult = await supabase.rpc("platform_update_project_billing_identity", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_billing_legal_name: billingLegalName,
    p_billing_tax_id: billingTaxId,
  });
  if (billingResult.error) {
    return { status: "error", message: "El proyecto se actualizó, pero no fue posible guardar su identidad fiscal.", fields };
  }

  revalidatePath("/platform/companies");
  revalidatePath(`/platform/companies/${companyId}`);
  revalidatePath("/");
  revalidatePath("/programming");
  return {
    status: "success",
    message: "Proyecto actualizado correctamente.",
    projectId,
  };
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
    return actionError(
      "El nombre debe tener entre 2 y 160 caracteres.",
      fields,
    );
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
    console.error("platform.createCompany failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
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

  if (
    !/^[0-9a-f-]{36}$/i.test(companyId) ||
    !["true", "false"].includes(activeValue)
  ) {
    return actionError("La solicitud de cambio de estado no es válida.");
  }

  const supabase = await authorizePlatformAction();
  if (!supabase) {
    return actionError(
      "No tienes autorización para cambiar el estado de empresas.",
    );
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
        .filter(
          (value): value is string =>
            typeof value === "string" && isUuid(value),
        ),
    ),
  ];

  if (!isUuid(companyId) || !isUuid(projectId)) {
    return actionError("La empresa o el proyecto seleccionado no es válido.");
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
