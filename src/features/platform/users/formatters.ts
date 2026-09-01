import type { PlatformUserAuthStatus } from "./types";
import { formatStatusLabel } from "@/lib/status-labels";

export function formatUserDate(value: string | null, includeTime = false) {
  if (!value) return "Nunca";

  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

export function authStatusLabel(status: PlatformUserAuthStatus) {
  return formatStatusLabel(status);
}
