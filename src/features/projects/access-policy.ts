export const PLATFORM_ADMIN_VIEW_SOURCE_ROLES = [
  "PURCHASING",
  "RECEPTION",
  "RESIDENT",
] as const;

export function selectOperationalViewPermissions(permissionCodes: string[]) {
  return [
    ...new Set(
      permissionCodes.filter(
        (permission) => permission.endsWith(".view") && !permission.startsWith("gmail."),
      ),
    ),
  ].sort();
}

export function hasUniversalOperationalViewRole(roleCodes: string[]) {
  return roleCodes.some((role) =>
    ["PURCHASING", "COMPANY_ADMIN", "PLATFORM_ADMIN"].includes(role),
  );
}
