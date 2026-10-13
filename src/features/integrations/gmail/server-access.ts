import "server-only";

import { isPlatformAdmin } from "@/features/platform/queries";
import {
  getOperationalProjectAccess,
  getOperationalProjectAccessForProject,
} from "@/features/projects/queries";

import {
  canUseGmailModule,
  type GmailModulePermission,
} from "./access-policy";

export async function getGmailProjectAccess(input: {
  userId: string;
  projectId: string;
  permission: GmailModulePermission;
}) {
  const [platformAdmin, scope] = await Promise.all([
    isPlatformAdmin(input.userId),
    getOperationalProjectAccessForProject(input.userId, input.projectId),
  ]);

  if (
    !scope ||
    !canUseGmailModule({
      isPlatformAdmin: platformAdmin,
      projectStatus: scope.project.status,
      permissions: scope.permissions,
      permission: input.permission,
    })
  ) {
    return null;
  }

  return { isPlatformAdmin: platformAdmin, scope };
}

export async function hasGmailModuleAccessForUser(
  userId: string,
  permission: GmailModulePermission,
) {
  if (await isPlatformAdmin(userId)) return true;

  const scopes = await getOperationalProjectAccess(userId);
  return scopes.some((scope) =>
    canUseGmailModule({
      isPlatformAdmin: false,
      projectStatus: scope.project.status,
      permissions: scope.permissions,
      permission,
    }),
  );
}
