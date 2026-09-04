import type { CompanyStatus } from "../types";
import { StatusBadge } from "@/components/ui/badge";
import { formatStatusLabel } from "@/lib/status-labels";

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const active = status === "ACTIVE";

  return <StatusBadge label={formatStatusLabel(status)} tone={active ? "success" : "neutral"} dot />;
}
