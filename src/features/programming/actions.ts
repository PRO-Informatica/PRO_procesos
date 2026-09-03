"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createClient } from "@/lib/supabase/server";

import { getProgrammingCatalogs, getProgrammingItems } from "./queries";
import {
  extractMixtoProgrammingWorkbook,
  MIXTO_WORKBOOK_ERROR,
} from "./mixto-listo-workbook";
import {
  PROGRAMMING_EFFECTIVE_STATUSES,
  type CreateProgrammingBatchState,
  type CreateProgrammingState,
  type ExtractProgrammingWorkbookState,
  type ProgrammingFilters,
  type ProgrammingLoadResult,
  type ProgrammingMutationIntent,
  type ProgrammingMutationState,
  type ProgrammingRange,
  type ProgrammingEffectiveStatus,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readTexts(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value.trim() : ""));
}

async function authorizeProject(projectId: string, permission?: string) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (
    context.status !== "ready" ||
    context.activeProject?.id !== projectId ||
    (permission && !context.permissions.includes(permission))
  ) {
    return null;
  }
  return context;
}

function localDateTimeToIso(value: string, timezone: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const desired = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  let guess = desired;

  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: timezone,
      }).formatToParts(new Date(guess));
      const get = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value);
      const represented = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second"),
      );
      guess += desired - represented;
    }
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

function localDateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function databaseErrorMessage(error: { code?: string; message: string }) {
  const message = error.message.toUpperCase();
  if (message.includes("PERMISSION_DENIED")) {
    return "No tienes permiso para realizar esta acción en el proyecto.";
  }
  if (message.includes("PROGRAMMING_VERSION_CONFLICT")) {
    return "La programación fue modificada por otro usuario.";
  }
  if (message.includes("PROGRAMMING_NOT_FOUND")) {
    return "La programación ya no está disponible.";
  }
  if (message.includes("PROGRAMMING_SCHEDULE_MUST_BE_FUTURE")) {
    return "No puede crear una programación para una fecha anterior a hoy.";
  }
  if (message.includes("PROGRAMMING_SCHEDULE_DATE_IN_PAST")) {
    return "No puede crear una programación para una fecha anterior a hoy.";
  }
  if (message.includes("PROGRAMMING_EDIT_WINDOW_CLOSED")) {
    return "Esta programación solo podía editarse hasta un día antes de la fecha programada.";
  }
  if (message.includes("PROGRAMMING_NOT_EDITABLE")) {
    return "Solo las programaciones pendientes de confirmación pueden editarse.";
  }
  if (message.includes("PROGRAMMING_NOT_PENDING_CONFIRMATION")) {
    return "La programación ya no está pendiente de confirmación.";
  }
  if (message.includes("PROGRAMMING_CANNOT_BE_CANCELLED")) {
    return "La programación ya no puede cancelarse en su estado actual.";
  }
  if (message.includes("PROGRAMMING_HAS_DISPATCHES")) {
    return "No se puede cancelar porque ya existen despachos relacionados.";
  }
  if (message.includes("PROGRAMMING_NOT_IN_EXECUTION")) {
    return "Solo una programación en ejecución puede cerrarse.";
  }
  if (message.includes("PROGRAMMING_REQUIRES_DISPATCH")) {
    return "La programación necesita al menos un despacho antes de cerrarse.";
  }
  if (message.includes("PROGRAMMING_DISPATCH_RESULT_REQUIRED")) {
    return "Todos los despachos deben tener un resultado antes del cierre.";
  }
  if (message.includes("PROGRAMMING_DISPATCH_GUIDE_MISSING")) {
    return "Un despacho contabilizable todavía no tiene guía registrada.";
  }
  if (message.includes("PROGRAMMING_CLOSE_REASON_REQUIRED")) {
    return "Explica el motivo del cierre cuando existe cantidad restante o excedente.";
  }
  if (message.includes("PROGRAMMING_CORRECTION_REASON_REQUIRED")) {
    return "Ingresa el motivo de la corrección.";
  }
  if (message.includes("PROGRAMMING_CANCELLATION_REASON_REQUIRED")) {
    return "Ingresa el motivo de la cancelación.";
  }
  if (message.includes("INVALID_PROGRAMMING_CONFIRMED_QUANTITY")) {
    return "La cantidad confirmada debe ser mayor que cero y no superar lo solicitado.";
  }
  if (message.includes("PROJECT_NOT_FOUND")) {
    return "El proyecto ya no está disponible.";
  }
  if (message.includes("SUPPLIER") && message.includes("NOT")) {
    return "El proveedor seleccionado no está disponible para este proyecto.";
  }
  if (message.includes("PROGRAMMING_MIXED_UNITS_NOT_SUPPORTED")) {
    return "Todos los productos deben utilizar la misma unidad de medida.";
  }
  if (message.includes("PROGRAMMING_REQUIRES_LINE")) {
    return "Agrega al menos un producto a la programación.";
  }
  if (message.includes("INVALID_PROGRAMMING_LINE")) {
    return "Revisa las cantidades y unidades de los productos.";
  }
  if (message.includes("INVALID_OR_INACTIVE_UNIT_OF_MEASURE")) {
    return "Una unidad de medida seleccionada ya no está disponible.";
  }
  if (error.code === "23503") {
    return "Uno de los datos seleccionados ya no está disponible.";
  }
  if (error.code === "23514" || message.includes("CHECK")) {
    return "Los datos no cumplen las reglas vigentes de programación.";
  }
  return "No fue posible completar la operación. Intenta nuevamente.";
}

const mutationPermissions: Record<ProgrammingMutationIntent, string> = {
  edit: "programming.modify",
  confirm: "programming.confirm",
  cancel: "programming.cancel",
  close: "programming.close",
};

function isMutationIntent(value: string): value is ProgrammingMutationIntent {
  return Object.prototype.hasOwnProperty.call(mutationPermissions, value);
}

export async function mutateProgrammingAction(
  _previousState: ProgrammingMutationState,
  formData: FormData,
): Promise<ProgrammingMutationState> {
  const intentValue = readText(formData, "intent");
  const projectId = readText(formData, "projectId");
  const programmingId = readText(formData, "programmingId");
  const expectedVersion = Number(readText(formData, "expectedVersion"));

  if (
    !isMutationIntent(intentValue) ||
    !UUID_PATTERN.test(projectId) ||
    !UUID_PATTERN.test(programmingId) ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return { status: "error", message: "La solicitud no es válida." };
  }

  const intent = intentValue;
  const context = await authorizeProject(projectId, mutationPermissions[intent]);
  if (!context) {
    return {
      status: "error",
      intent,
      message: "No tienes permiso para realizar esta acción.",
    };
  }

  const supabase = await createClient();
  let error: { code?: string; message: string } | null = null;

  if (intent === "edit") {
    const supplierId = readText(formData, "supplierId");
    const scheduledAt = readText(formData, "scheduledAt");
    const quantities = readTexts(formData, "lineQuantity");
    const unitCodes = readTexts(formData, "lineUnitCode");
    const notes = readText(formData, "notes");
    const lines = quantities.map((quantity, index) => ({
      quantity: Number(quantity),
      unit_code: unitCodes[index] ?? "",
    }));

    if (
      !UUID_PATTERN.test(supplierId) ||
      !lines.length ||
      quantities.length !== unitCodes.length ||
      lines.some(
        (line) =>
          !Number.isFinite(line.quantity) ||
          line.quantity <= 0 ||
          !line.unit_code ||
          line.unit_code.length > 32,
      )
    ) {
      return {
        status: "error",
        intent,
        message: "Revisa el proveedor y las líneas de productos.",
      };
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("timezone")
      .eq("id", projectId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    const scheduledAtIso = project
      ? localDateTimeToIso(
          scheduledAt,
          project.timezone || "America/Guatemala",
        )
      : null;
    if (projectError || !project || !scheduledAtIso) {
      return {
        status: "error",
        intent,
        message: "La fecha y hora programadas no son válidas.",
      };
    }
    if (scheduledAt.slice(0, 10) <= localDateKey(new Date(), project.timezone || "America/Guatemala")) {
      return {
        status: "error",
        intent,
        message: "La edición solo está disponible hasta un día antes de la fecha programada.",
      };
    }

    ({ error } = await supabase.rpc("update_programming_with_lines", {
      p_programming_id: programmingId,
      p_expected_version: expectedVersion,
      p_supplier_id: supplierId,
      p_scheduled_at: scheduledAtIso,
      p_lines: lines,
      p_notes: notes || null,
    }));
  } else if (intent === "confirm") {
    const confirmedQuantity = Number(readText(formData, "confirmedQuantity"));
    if (!Number.isFinite(confirmedQuantity) || confirmedQuantity <= 0) {
      return {
        status: "error",
        intent,
        message: "Ingresa una cantidad confirmada válida.",
      };
    }
    ({ error } = await supabase.rpc("confirm_programming", {
      p_programming_id: programmingId,
      p_confirmed_quantity: confirmedQuantity,
      p_expected_version: expectedVersion,
      p_notes: null,
    }));
  } else if (intent === "cancel") {
    ({ error } = await supabase.rpc("cancel_programming", {
      p_programming_id: programmingId,
      p_expected_version: expectedVersion,
      p_reason: readText(formData, "reason"),
    }));
  } else {
    ({ error } = await supabase.rpc("close_programming", {
      p_programming_id: programmingId,
      p_expected_version: expectedVersion,
      p_reason: readText(formData, "reason") || null,
    }));
  }

  if (error) {
    const conflict = error.message
      .toUpperCase()
      .includes("PROGRAMMING_VERSION_CONFLICT");
    return {
      status: "error",
      intent,
      conflict,
      message: databaseErrorMessage(error),
    };
  }

  revalidatePath("/programming");
  revalidatePath(`/programming/${programmingId}`);
  return {
    status: "success",
    intent,
    message: "La programación se actualizó correctamente.",
  };
}

export async function loadProgrammingRange(
  projectId: string,
  range: ProgrammingRange,
  filters: ProgrammingFilters,
): Promise<ProgrammingLoadResult> {
  if (!UUID_PATTERN.test(projectId)) {
    return { status: "error", message: "El proyecto solicitado no es válido." };
  }
  const context = await authorizeProject(projectId, "programming.view");
  if (!context) {
    return {
      status: "error",
      message: "No tienes acceso operacional al proyecto solicitado.",
    };
  }
  const safeFilters: ProgrammingFilters = {
    supplierId:
      filters.supplierId && UUID_PATTERN.test(filters.supplierId)
        ? filters.supplierId
        : undefined,
    status: PROGRAMMING_EFFECTIVE_STATUSES.includes(
      filters.status as ProgrammingEffectiveStatus,
    )
      ? filters.status
      : undefined,
  };
  try {
    return {
      status: "success",
      items: await getProgrammingItems(
        projectId,
        range,
        safeFilters,
        context.activeProject!.timezone,
      ),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "No fue posible actualizar las programaciones.",
    };
  }
}

export async function createProgrammingAction(
  _previousState: CreateProgrammingState,
  formData: FormData,
): Promise<CreateProgrammingState> {
  const projectId = readText(formData, "projectId");
  const supplierId = readText(formData, "supplierId");
  const scheduledAt = readText(formData, "scheduledAt");
  const quantities = readTexts(formData, "lineQuantity");
  const unitCodes = readTexts(formData, "lineUnitCode");
  const notes = readText(formData, "notes");
  const lines = quantities.map((quantity, index) => ({
    quantity,
    unitCode: unitCodes[index] ?? "",
  }));
  const fields = {
    supplierId,
    scheduledAt,
    lines,
    notes,
  };

  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(supplierId)) {
    return { status: "error", message: "Selecciona un proyecto y proveedor válidos.", fields };
  }
  if (!lines.length || quantities.length !== unitCodes.length) {
    return { status: "error", message: "Agrega al menos un producto válido.", fields };
  }
  if (
    lines.some(({ quantity, unitCode }) => {
      const parsedQuantity = Number(quantity);
      return !Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !unitCode || unitCode.length > 32;
    })
  ) {
    return {
      status: "error",
      message: "Cada producto debe tener una cantidad mayor que cero y una unidad válida.",
      fields,
    };
  }

  await requireActiveProfile();
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("timezone")
    .eq("id", projectId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (projectError || !project) {
    return {
      status: "error",
      message: "El proyecto ya no está disponible.",
      fields,
    };
  }
  const scheduledAtIso = localDateTimeToIso(
    scheduledAt,
    project.timezone || "America/Guatemala",
  );
  if (!scheduledAtIso) {
    return {
      status: "error",
      message: "La fecha y hora programadas no son válidas.",
      fields,
    };
  }
  if (scheduledAt.slice(0, 10) < localDateKey(new Date(), project.timezone || "America/Guatemala")) {
    return {
      status: "error",
      message: "No puede crear una programación para una fecha anterior a hoy.",
      fields,
    };
  }

  const { data, error } = await supabase.rpc("create_programming_with_lines", {
    p_project_id: projectId,
    p_supplier_id: supplierId,
    p_scheduled_at: scheduledAtIso,
    p_lines: lines.map(({ quantity, unitCode }) => ({
      quantity: Number(quantity),
      unit_code: unitCode,
    })),
    p_notes: notes || null,
  });

  if (error) {
    return { status: "error", message: databaseErrorMessage(error), fields };
  }
  if (typeof data !== "string" || !UUID_PATTERN.test(data)) {
    return {
      status: "error",
      message: "La programación fue procesada, pero no recibimos un identificador válido.",
      fields,
    };
  }

  return {
    status: "success",
    message: "Programación creada pendiente de confirmación.",
    programmingId: data,
  };
}

export async function extractProgrammingWorkbookAction(
  _previousState: ExtractProgrammingWorkbookState,
  formData: FormData,
): Promise<ExtractProgrammingWorkbookState> {
  const projectId = readText(formData, "projectId");
  const file = formData.get("workbook");
  if (!UUID_PATTERN.test(projectId)) {
    return { status: "error", message: MIXTO_WORKBOOK_ERROR };
  }
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "Selecciona un archivo Excel .xlsx antes de generar la vista previa.",
    };
  }
  const context = await authorizeProject(projectId, "programming.create");
  if (!context) {
    return { status: "error", message: "No tienes permiso para cargar programaciones." };
  }
  try {
    const billingLegalName =
      context.activeProject?.billingLegalName?.trim() ?? "";
    const [rows, catalogs] = await Promise.all([
      extractMixtoProgrammingWorkbook(file, billingLegalName),
      getProgrammingCatalogs(projectId),
    ]);
    const defaultSupplier =
      catalogs.suppliers.find((supplier) =>
        `${supplier.code} ${supplier.name}`.toUpperCase().includes("MIXTO"),
      ) ?? (catalogs.suppliers.length === 1 ? catalogs.suppliers[0] : null);
    const m3Unit = catalogs.units.find(
      (unit) => unit.code.trim().toUpperCase() === "M3",
    );
    const today = localDateKey(new Date(), context.activeProject?.timezone || "America/Guatemala");
    return {
      status: "success",
      fileName: file.name,
      rows: rows.map((row) => ({
        ...row,
        supplierId: defaultSupplier?.id ?? "",
        unitCode: m3Unit?.code ?? "",
        errors: [
          ...row.errors,
          ...(row.scheduledAt && row.scheduledAt.slice(0, 10) < today
            ? ["La fecha es anterior a hoy"]
            : []),
          ...(!defaultSupplier ? ["Selecciona un proveedor"] : []),
          ...(!m3Unit ? ["La unidad M3 no está activa"] : []),
        ],
      })),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : MIXTO_WORKBOOK_ERROR,
    };
  }
}

export async function createProgrammingBatchAction(
  _previousState: CreateProgrammingBatchState,
  formData: FormData,
): Promise<CreateProgrammingBatchState> {
  const projectId = readText(formData, "projectId");
  const rawRows = readText(formData, "rows");
  if (!UUID_PATTERN.test(projectId) || !rawRows) {
    return { status: "error", message: "La vista previa no es válida." };
  }
  const context = await authorizeProject(projectId, "programming.create");
  if (!context) {
    return { status: "error", message: "No tienes permiso para crear programaciones." };
  }
  let rows: Array<{
    scheduledAt: string;
    quantity: string;
    unitCode: string;
    supplierId: string;
    notes: string;
  }>;
  try {
    rows = JSON.parse(rawRows);
  } catch {
    return { status: "error", message: "La vista previa no es válida." };
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 250) {
    return { status: "error", message: "La carga debe contener entre 1 y 250 filas." };
  }
  const timezone = context.activeProject?.timezone || "America/Guatemala";
  const today = localDateKey(new Date(), timezone);
  const items = [];
  for (const [index, row] of rows.entries()) {
    const quantity = Number(row.quantity);
    const scheduledAt = localDateTimeToIso(row.scheduledAt, timezone);
    if (
      !scheduledAt || row.scheduledAt.slice(0, 10) < today ||
      !Number.isFinite(quantity) || quantity <= 0 ||
      !UUID_PATTERN.test(row.supplierId) || !row.unitCode
    ) {
      return { status: "error", message: `Revisa la fila ${index + 1} de la vista previa.` };
    }
    items.push({
      supplier_id: row.supplierId,
      scheduled_at: scheduledAt,
      lines: [{ quantity, unit_code: row.unitCode }],
      notes: row.notes || null,
    });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_programming_batch", {
    p_project_id: projectId,
    p_items: items,
  });
  if (error) return { status: "error", message: databaseErrorMessage(error) };
  const result = data as { programming_ids?: unknown } | null;
  const programmingIds = Array.isArray(result?.programming_ids)
    ? result.programming_ids.filter((id): id is string => typeof id === "string")
    : [];
  revalidatePath("/programming");
  return {
    status: "success",
    programmingIds,
    message: `${programmingIds.length} programaciones creadas pendientes de confirmación.`,
  };
}
