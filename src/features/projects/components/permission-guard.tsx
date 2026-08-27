"use client";

import { useHasPermission } from "../project-context";

export function PermissionGuard({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return useHasPermission(permission) ? children : fallback;
}
