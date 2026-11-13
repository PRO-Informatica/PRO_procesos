import type { ProgrammingEffectiveStatus, ProgrammingItem } from "./types";

export type KanbanMoveTarget = "IN_EXECUTION" | "CANCELLED";
export type KanbanMovePermissions = { canStart: boolean; canCancel: boolean };

export function getKanbanMoveTargets(
  item: Pick<ProgrammingItem, "status" | "effectiveStatus"> & { dispatches: readonly unknown[] },
  permissions: KanbanMovePermissions,
): KanbanMoveTarget[] {
  if (item.status !== "CONFIRMED" || item.effectiveStatus !== "CONFIRMED" || item.dispatches.length > 0) return [];
  return [
    ...(permissions.canStart ? ["IN_EXECUTION" as const] : []),
    ...(permissions.canCancel ? ["CANCELLED" as const] : []),
  ];
}

export function isKanbanMoveTarget(status: ProgrammingEffectiveStatus): status is KanbanMoveTarget {
  return status === "IN_EXECUTION" || status === "CANCELLED";
}
