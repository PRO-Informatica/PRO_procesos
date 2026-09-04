import { StatusBadge } from "@/components/ui/badge";

import { formatBatchStatus } from "../formatters";
import type { BatchStatus } from "../types";

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <StatusBadge label={formatBatchStatus(status)} tone={status === "OPEN" ? "info" : "neutral"} dot />;
}
