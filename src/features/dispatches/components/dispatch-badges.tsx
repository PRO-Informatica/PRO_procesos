import { StatusBadge } from "@/components/ui/badge";

import { formatDispatchResult, formatDispatchStatus } from "../formatters";
import type { DispatchResult, DispatchStatus } from "../types";

export function DispatchStatusBadge({ status, billingComplete }: { status: DispatchStatus; billingComplete?: boolean }) {
  if (status === "COMPLETED" && billingComplete === false) {
    return <StatusBadge label="Pendiente de conciliación" tone="warning" dot />;
  }
  return <StatusBadge label={formatDispatchStatus(status)} tone={status === "COMPLETED" ? "success" : "info"} dot />;
}

export function DispatchResultBadge({ result }: { result: DispatchResult | null }) {
  const tone = result === "DISPATCHED" ? "success" : result === "NOT_DISPATCHED" ? "danger" : "warning";
  return <StatusBadge label={formatDispatchResult(result)} tone={tone} />;
}
