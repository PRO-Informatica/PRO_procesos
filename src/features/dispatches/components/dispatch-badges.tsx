import { Badge, StatusBadge } from "@/components/ui/badge";
import { programmingStatusTone } from "@/features/programming/formatters";

import { formatDispatchResult, formatDispatchStatus } from "../formatters";
import type { DispatchResult, DispatchStatus } from "../types";

export function DispatchStatusBadge({ status, billingComplete, residentView = false }: { status: DispatchStatus; billingComplete?: boolean; residentView?: boolean }) {
  if (residentView && status === "COMPLETED") {
    return <Badge className={programmingStatusTone("DISPATCH_COMPLETED", true)} dot>Despacho completo</Badge>;
  }
  if (status === "COMPLETED" && billingComplete === false) {
    return <StatusBadge label="Pendiente de conciliación" tone="warning" dot />;
  }
  return <StatusBadge label={formatDispatchStatus(status)} tone={status === "COMPLETED" ? "success" : "info"} dot />;
}

export function DispatchResultBadge({ result }: { result: DispatchResult | null }) {
  const tone = result === "DISPATCHED" ? "success" : result === "NOT_DISPATCHED" ? "danger" : "warning";
  return <StatusBadge label={formatDispatchResult(result)} tone={tone} />;
}
