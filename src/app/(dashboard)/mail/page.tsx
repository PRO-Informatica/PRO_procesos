import { redirect } from "next/navigation";

import { requireActiveProfile } from "@/features/auth/queries";
import { canUseGmailModule } from "@/features/integrations/gmail/access-policy";
import { GmailMailboxWorkspace } from "@/features/integrations/gmail/components/gmail-mailbox-workspace";
import { getGmailServerEnvironment } from "@/features/integrations/gmail/server-environment";
import { getGmailConnectionPublicStatus } from "@/features/integrations/gmail/service";
import { isPlatformAdmin } from "@/features/platform/queries";
import { getProjectContext } from "@/features/projects/queries";

export const dynamic = "force-dynamic";

export default async function MailPage() {
  const profile = await requireActiveProfile();
  const [context, platformAdmin] = await Promise.all([
    getProjectContext(profile.id),
    isPlatformAdmin(profile.id),
  ]);
  if (context.status !== "ready" || !context.activeProject) redirect("/");
  const canView = canUseGmailModule({
    isPlatformAdmin: platformAdmin,
    projectStatus: context.activeProject.status,
    permissions: context.permissions,
    permission: "gmail.mailbox.view",
  });
  if (!canView) redirect("/");
  const connection = await getGmailConnectionPublicStatus(profile.id);
  if (!connection.connected || !connection.email) redirect("/integrations/gmail");
  const gmailEnvironment = getGmailServerEnvironment();
  return (
    <GmailMailboxWorkspace
      attachmentMaxBytes={gmailEnvironment.attachmentMaxBytes ?? 0}
      projectId={context.activeProject.id}
      connectedEmail={connection.email}
      canSend={canUseGmailModule({
        isPlatformAdmin: platformAdmin,
        projectStatus: context.activeProject.status,
        permissions: context.permissions,
        permission: "gmail.mail.send",
      })}
      initialRecipients={gmailEnvironment.recipientEmails}
    />
  );
}
