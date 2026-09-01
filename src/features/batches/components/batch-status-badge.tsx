import { batchStatusTone, formatBatchStatus } from "../formatters";
import type { BatchStatus } from "../types";

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${batchStatusTone(status)}`}>
      {formatBatchStatus(status)}
    </span>
  );
}
