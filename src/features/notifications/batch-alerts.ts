import { batchOverdueAt, batchWeekEnd } from "../batches/period-policy.ts";
import type { OverdueBatch } from "../batches/types.ts";
import type { OperationalNotification } from "./types.ts";

export function batchOverdueNotifications(batches: OverdueBatch[], context: {
  projectId: string; projectName: string; timezone: string;
}): OperationalNotification[] {
  return batches.map((batch) => {
    const overdueAt = batchOverdueAt(batch.periodStart, context.timezone);
    return {
      key: `batch-overdue:${batch.id}`,
      title: "Lote pendiente de cierre",
      description: `El lote ${batch.code} terminó su semana el ${batchWeekEnd(batch.periodStart)} y sigue abierto. Ciérralo para poder crear un lote de otra semana.`,
      createdAt: batch.createdAt && new Date(batch.createdAt) > new Date(overdueAt) ? batch.createdAt : overdueAt,
      type: "BATCH", href: `/batches/${batch.id}`,
      projectId: context.projectId, projectName: context.projectName, read: false,
    };
  });
}
