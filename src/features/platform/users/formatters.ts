import type { PlatformUserAuthStatus } from "./types";

export function formatUserDate(value: string | null, includeTime = false) {
  if (!value) return "Nunca";

  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

export function authStatusLabel(status: PlatformUserAuthStatus) {
  const labels: Record<PlatformUserAuthStatus, string> = {
    BANNED: "Bloqueado en Auth",
    CONFIRMED: "Email confirmado",
    INVITED: "Invitación pendiente",
    UNCONFIRMED: "Email sin confirmar",
  };

  return labels[status];
}
