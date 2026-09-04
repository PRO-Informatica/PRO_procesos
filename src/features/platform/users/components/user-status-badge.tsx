import { authStatusLabel } from "../formatters";
import type { PlatformUserAuthStatus } from "../types";
import { StatusBadge } from "@/components/ui/badge";

export function UserProfileStatusBadge({ active }: { active: boolean }) {
  return <StatusBadge label={active ? "Activo" : "Inactivo"} tone={active ? "success" : "neutral"} dot />;
}

export function UserAuthStatusBadge({ status }: { status: PlatformUserAuthStatus }) {
  const tone =
    status === "CONFIRMED"
      ? "success"
      : status === "BANNED"
        ? "danger"
        : status === "INVITED"
          ? "brand"
          : "neutral";

  return <StatusBadge label={authStatusLabel(status)} tone={tone} />;
}
