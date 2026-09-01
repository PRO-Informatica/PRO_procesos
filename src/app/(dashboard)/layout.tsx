import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { requireActiveProfile } from "@/features/auth/queries";
import { PlatformProvider } from "@/features/platform/platform-context";
import { isPlatformAdmin } from "@/features/platform/queries";
import { ProjectProvider } from "@/features/projects/project-context";
import { getProjectContext } from "@/features/projects/queries";
import { getUnreadNotificationCount } from "@/features/notifications/queries";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireActiveProfile();
  const [platformAdmin, projectContext] = await Promise.all([
    isPlatformAdmin(profile.id),
    getProjectContext(profile.id),
  ]);
  const hasOperationalAccess = projectContext.status === "ready";
  const unreadNotifications = projectContext.status === "ready" && projectContext.activeProject
    ? await getUnreadNotificationCount({ projectId: projectContext.activeProject.id, projectName: projectContext.activeProject.name, userId: profile.id, permissions: projectContext.permissions })
    : 0;

  if (platformAdmin && projectContext.status === "empty") {
    redirect("/platform");
  }

  return (
    <PlatformProvider
      value={{ isPlatformAdmin: platformAdmin, hasOperationalAccess }}
    >
      <ProjectProvider value={projectContext}>
        <AppShell profile={profile} unreadNotifications={unreadNotifications}>{children}</AppShell>
      </ProjectProvider>
    </PlatformProvider>
  );
}
