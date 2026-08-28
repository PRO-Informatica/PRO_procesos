import { authStatusLabel } from "../formatters";
import type { PlatformUserAuthStatus } from "../types";

export function UserProfileStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-success-soft text-success"
          : "bg-muted text-foreground-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${active ? "bg-success" : "bg-foreground-muted"}`}
      />
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

export function UserAuthStatusBadge({ status }: { status: PlatformUserAuthStatus }) {
  const className =
    status === "CONFIRMED"
      ? "bg-success-soft text-success"
      : status === "BANNED"
        ? "bg-destructive-soft text-destructive"
        : status === "INVITED"
          ? "bg-brand-soft text-brand-strong"
          : "bg-muted text-foreground-muted";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {authStatusLabel(status)}
    </span>
  );
}
