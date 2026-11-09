export const PLATFORM_ADMIN_VIEW_SOURCE_ROLES = [
  "PURCHASING",
  "SUPERVISOR",
  "RESIDENT",
] as const;

// During the role migration, the same role ID can still have its old code.
export const PLATFORM_ADMIN_VIEW_ROLE_CODES = [
  ...PLATFORM_ADMIN_VIEW_SOURCE_ROLES,
  "RECEPTION",
] as const;

export function selectPlatformAdminViewRoles<T extends { id: string; code: string }>(roles: T[]) {
  const selected = PLATFORM_ADMIN_VIEW_SOURCE_ROLES.map((code) =>
    roles.find((role) => role.code === code) ??
    (code === "SUPERVISOR" ? roles.find((role) => role.code === "RECEPTION") : undefined),
  );
  return selected.every((role) => role !== undefined) ? selected : null;
}

export type OperationalAccess = {
  roleCodes: string[];
  permissions: string[];
  isCompanyAdmin: boolean;
};

export function selectOperationalViewPermissions(permissionCodes: string[]) {
  return [
    ...new Set(
      permissionCodes.filter(
        (permission) => permission.endsWith(".view") && !permission.startsWith("gmail."),
      ),
    ),
  ].sort();
}

export function mergePlatformAdminProjectAccess(
  platformAdminAccess: OperationalAccess | null,
  projectAccess: OperationalAccess,
): OperationalAccess {
  if (!platformAdminAccess) return projectAccess;

  return {
    roleCodes: [
      ...new Set([...platformAdminAccess.roleCodes, ...projectAccess.roleCodes]),
    ],
    permissions: [
      ...new Set([...platformAdminAccess.permissions, ...projectAccess.permissions]),
    ],
    isCompanyAdmin: projectAccess.isCompanyAdmin,
  };
}

export function hasUniversalOperationalViewRole(roleCodes: string[]) {
  return roleCodes.some((role) =>
    ["PURCHASING", "COMPANY_ADMIN", "PLATFORM_ADMIN"].includes(role),
  );
}
