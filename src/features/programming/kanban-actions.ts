"use server";

import { requireActiveProfile } from "@/features/auth/queries";
import { startDispatchAction } from "@/features/dispatches/actions";
import { getProjectContext } from "@/features/projects/queries";
import { createClient } from "@/lib/supabase/server";

import { mutateProgrammingAction } from "./actions";
import { getEffectiveProgrammingStatus } from "./availability";
import { getKanbanMoveTargets } from "./kanban-policy";
import { usesResidentProgrammingView } from "./status-presentation";
import type { ProgrammingMutationState, ProgrammingStatus } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function moveProgrammingKanbanAction(
  _previous: ProgrammingMutationState,
  form: FormData,
): Promise<ProgrammingMutationState> {
  const projectId = String(form.get("projectId") ?? "");
  const programmingId = String(form.get("programmingId") ?? "");
  const expectedVersion = Number(form.get("expectedVersion"));
  const intent = form.get("intent");
  const target = intent === "start" ? "IN_EXECUTION" : intent === "cancel" ? "CANCELLED" : null;
  if (!UUID.test(projectId) || !UUID.test(programmingId) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !target) {
    return { status: "error", message: "El movimiento solicitado no es válido." };
  }
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  const permissions = {
    canStart: context.permissions.includes("dispatch.create"),
    canCancel: context.permissions.includes("programming.cancel"),
  };
  if (context.status !== "ready" || context.activeProject?.id !== projectId ||
    !usesResidentProgrammingView(context.roleCodes) || !context.permissions.includes("programming.view") ||
    !(target === "IN_EXECUTION" ? permissions.canStart : permissions.canCancel)) {
    return { status: "error", message: "No tienes permiso para mover esta programación en el Kanban." };
  }

  const db = await createClient();
  const [programming, dispatches] = await Promise.all([
    db.from("programming").select("status, version, scheduled_at").eq("project_id", projectId).eq("id", programmingId)
      .maybeSingle<{ status: ProgrammingStatus; version: number; scheduled_at: string }>(),
    db.from("dispatches").select("id").eq("project_id", projectId).eq("programming_id", programmingId).limit(1),
  ]);
  if (programming.error || dispatches.error || !programming.data) {
    return { status: "error", message: "No fue posible comprobar el estado actual. Actualiza el tablero." };
  }
  const row = programming.data;
  if (row.version !== expectedVersion) {
    return { status: "error", conflict: true, message: "La programación cambió. Actualiza el tablero antes de moverla." };
  }
  const item = {
    status: row.status,
    effectiveStatus: getEffectiveProgrammingStatus({ status: row.status, scheduledAt: row.scheduled_at,
      operationStarted: Boolean(dispatches.data?.length), timezone: context.activeProject.timezone }),
    dispatches: dispatches.data ?? [],
  };
  if (!getKanbanMoveTargets(item, permissions).includes(target)) {
    return { status: "error", conflict: true, message: "Solo puedes mover programaciones confirmadas sin despacho a En ejecución o Cancelado." };
  }
  if (target === "CANCELLED") return mutateProgrammingAction(_previous, form);
  const result = await startDispatchAction({ status: "idle" }, form);
  return { status: result.status, message: result.message };
}
