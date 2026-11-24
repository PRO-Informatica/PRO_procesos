import { StatusBadge } from "@/components/ui/badge";

import { formatBatchStatus } from "../formatters";
import { batchPeriodLabel } from "../period-policy";
import type { BatchStatus, BatchSummary } from "../types";

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <StatusBadge label={formatBatchStatus(status)} tone={status === "OPEN" ? "info" : "neutral"} dot />;
}

export function BatchPeriodBadge({ batch }: { batch: Pick<BatchSummary, "periodKind" | "periodStart" | "periodEnd"> }) {
  const label = batchPeriodLabel(batch.periodKind, batch.periodStart, batch.periodEnd);
  return <StatusBadge label={label} tone={label === "Lote compartido" ? "warning" : "neutral"} />;
}
