export const PLATFORM_ADMIN_VIEW_SOURCE_ROLES = [
  "PURCHASING",
  "RECEPTION",
  "RESIDENT",
] as const;

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
