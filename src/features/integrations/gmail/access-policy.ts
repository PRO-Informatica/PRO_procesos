export type GmailModulePermission =
  | "gmail.mailbox.view"
  | "gmail.mail.send";

export function canUseGmailModule(input: {
  isPlatformAdmin: boolean;
  projectStatus: string | null | undefined;
  permissions: readonly string[];
  permission: GmailModulePermission;
}) {
  if (input.isPlatformAdmin) return true;

  return (
    input.projectStatus === "ACTIVE" &&
    input.permissions.includes(input.permission)
  );
}
