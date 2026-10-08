"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createClient } from "@/lib/supabase/server";

import { getProgrammingCatalogs, getProgrammingItems } from "./queries";
import {
  extractMixtoProgrammingWorkbook,
  isApprovedProgrammingDayAllowed,
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
    return "Solo pueden editarse programaciones pendientes o confirmadas que aún no tengan despacho.";
  }
  if (message.includes("PROGRAMMING_EDIT_HAS_DISPATCHES")) {
    return "No se puede editar porque el despacho ya fue iniciado.";
  }
  if (message.includes("PROGRAMMING_EDIT_REASON_REQUIRED")) {
    return "Ingresa el motivo de la edición.";
  }
  if (message.includes("PROGRAMMING_EDIT_REASON_TOO_LONG")) {
    return "El motivo de la edición no puede superar 1000 caracteres.";
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
  if (message.includes("PROGRAMMING_ORDER_NUMBER_REQUIRED")) {
    return "Pedido No. es obligatorio antes de confirmar la programación.";
  }
  if (message.includes("PROGRAMMING_CONCRETE_TYPE_REQUIRED")) {
    return "Tipo de concreto es obligatorio en todos los productos.";
  }
  if (message.includes("PROGRAMMING_BATCH_ROW_INVALID")) {
    return "Una fila del lote aprobado no cumple las reglas de programación.";
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
    const concreteTypes = readTexts(formData, "lineConcreteType");
    const orderNumber = readText(formData, "orderNumber");
    const reason = readText(formData, "reason");
    const notes = readText(formData, "notes");
    const lines = quantities.map((quantity, index) => ({
      quantity: Number(quantity),
      unit_code: unitCodes[index] ?? "",
      concrete_type: concreteTypes[index] ?? "",
    }));

    if (
      !UUID_PATTERN.test(supplierId) ||
      !lines.length ||
      quantities.length !== unitCodes.length ||
      quantities.length !== concreteTypes.length ||
      !orderNumber ||
      !reason ||
      reason.length > 1000 ||
      lines.some(
        (line) =>
          !Number.isFinite(line.quantity) ||
          line.quantity <= 0 ||
          !line.unit_code ||
          !line.concrete_type ||
          line.unit_code.length > 32,
      )
    ) {
      return {
        status: "error",
        intent,
        message: !reason
          ? "Ingresa el motivo de la edición."
          : reason.length > 1000
            ? "El motivo de la edición no puede superar 1000 caracteres."
            : "Revisa el proveedor y las líneas de productos.",
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

    ({ error } = await supabase.rpc("update_programming_with_details", {
      p_programming_id: programmingId,
      p_expected_version: expectedVersion,
      p_supplier_id: supplierId,
      p_scheduled_at: scheduledAtIso,
      p_lines: lines,
      p_notes: notes || null,
      p_order_number: orderNumber,
      p_reason: reason,
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
  const concreteTypes = readTexts(formData, "lineConcreteType");
  const orderNumber = readText(formData, "orderNumber");
  const notes = readText(formData, "notes");
  const lines = quantities.map((quantity, index) => ({
    quantity,
    unitCode: unitCodes[index] ?? "",
    concreteType: concreteTypes[index] ?? "",
  }));
  const fields = {
    supplierId,
    scheduledAt,
    orderNumber,
    lines,
    notes,
  };

  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(supplierId)) {
    return { status: "error", message: "Selecciona un proyecto y proveedor válidos.", fields };
  }
  if (!orderNumber || orderNumber.length > 120) {
    return { status: "error", message: "Ingresa un Pedido No. válido.", fields };
  }
  if (!lines.length || quantities.length !== unitCodes.length || quantities.length !== concreteTypes.length) {
    return { status: "error", message: "Agrega al menos un producto válido.", fields };
  }
  if (
    lines.some(({ quantity, unitCode, concreteType }) => {
      const parsedQuantity = Number(quantity);
      return !Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !unitCode || unitCode.length > 32 || !concreteType || concreteType.length > 160;
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

  const { data, error } = await supabase.rpc("create_programming_with_details", {
    p_project_id: projectId,
    p_supplier_id: supplierId,
    p_scheduled_at: scheduledAtIso,
    p_lines: lines.map(({ quantity, unitCode, concreteType }) => ({
      quantity: Number(quantity),
      unit_code: unitCode,
      concrete_type: concreteType,
    })),
    p_notes: notes || null,
    p_order_number: orderNumber,
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
    const [workbook, catalogs] = await Promise.all([
      extractMixtoProgrammingWorkbook(file, {
        id: context.activeProject?.id,
        label: context.activeProject
          ? `${context.activeProject.code} · ${context.activeProject.name}`
          : undefined,
        billingLegalName: context.activeProject?.billingLegalName?.trim() ?? "",
        address: context.activeProject?.address?.trim() ?? "",
        candidateProjects: context.projects
          .filter((project) => project.status === "ACTIVE")
          .map((project) => ({
            id: project.id,
            label: `${project.code} · ${project.name}`,
            address: project.address,
            billingLegalName: project.billingLegalName,
          })),
      }),
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
      warnings: workbook.warnings,
      rows: workbook.rows.map((row) => ({
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
  const file = formData.get("workbook");
  if (!UUID_PATTERN.test(projectId) || !rawRows || !(file instanceof File) || file.size === 0) {
    return { status: "error", message: "La vista previa no es válida." };
  }
  const context = await authorizeProject(projectId, "programming.create");
  if (!context) {
    return { status: "error", message: "No tienes permiso para crear programaciones." };
  }
  let submittedRows: Array<{
    sourceRow: number;
    supplierId: string;
    notes: string;
  }>;
  try {
    submittedRows = JSON.parse(rawRows);
  } catch {
    return { status: "error", message: "La vista previa no es válida." };
  }
  if (!Array.isArray(submittedRows) || !submittedRows.length || submittedRows.length > 250) {
    return { status: "error", message: "La carga debe contener entre 1 y 250 filas." };
  }
  const timezone = context.activeProject?.timezone || "America/Guatemala";
  const today = localDateKey(new Date(), timezone);
  let workbook;
  try {
    workbook = await extractMixtoProgrammingWorkbook(file, {
      id: context.activeProject?.id,
      label: context.activeProject ? `${context.activeProject.code} · ${context.activeProject.name}` : undefined,
      billingLegalName: context.activeProject?.billingLegalName?.trim() ?? "",
      address: context.activeProject?.address?.trim() ?? "",
      candidateProjects: context.projects.filter((project) => project.status === "ACTIVE").map((project) => ({
        id: project.id,
        label: `${project.code} · ${project.name}`,
        address: project.address,
        billingLegalName: project.billingLegalName,
      })),
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : MIXTO_WORKBOOK_ERROR };
  }
  const submittedBySourceRow = new Map(submittedRows.map((row) => [Number(row.sourceRow), row]));
  if (workbook.rows.length !== submittedRows.length) {
    return { status: "error", message: "El archivo original no coincide con la vista previa." };
  }
  const catalogs = await getProgrammingCatalogs(projectId);
  const m3Unit = catalogs.units.find((unit) => unit.code.trim().toUpperCase() === "M3");
  if (!m3Unit) return { status: "error", message: "La unidad M3 no está activa." };
  const items = [];
  for (const row of workbook.rows) {
    const submitted = submittedBySourceRow.get(row.sourceRow);
    if (!submitted) return { status: "error", message: `La fila Excel ${row.sourceRow} no coincide con la vista previa.` };
    const quantity = Number(row.quantity);
    const scheduledAt = localDateTimeToIso(row.scheduledAt, timezone);
    if (
      !scheduledAt || !isApprovedProgrammingDayAllowed(row.scheduledAt, today) ||
      !Number.isFinite(quantity) || quantity <= 0 ||
      !UUID_PATTERN.test(submitted.supplierId) || !row.orderNumber || !row.concreteType
    ) {
      return { status: "error", message: `Revisa la fila Excel ${row.sourceRow}; la fecha aprobada debe ser de hoy o posterior y los campos obligatorios deben estar completos.` };
    }
    items.push({
      supplier_id: submitted.supplierId,
      scheduled_at: scheduledAt,
      order_number: row.orderNumber,
      lines: [{ quantity, unit_code: m3Unit.code, concrete_type: row.concreteType }],
      notes: submitted.notes?.trim() || row.notes || null,
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
    message: `${programmingIds.length} programaciones aprobadas y listas para despachar.`,
  };
}
