import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { requireActiveProfile } from "@/features/auth/queries";
import { PlatformProvider } from "@/features/platform/platform-context";
import { isPlatformAdmin } from "@/features/platform/queries";
import { ProjectProvider } from "@/features/projects/project-context";
import { getProjectContext } from "@/features/projects/queries";

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

  if (platformAdmin && projectContext.status === "empty") {
    redirect("/platform");
  }

  return (
    <PlatformProvider
      value={{ isPlatformAdmin: platformAdmin, hasOperationalAccess }}
    >
      <ProjectProvider value={projectContext}>
        <AppShell profile={profile}>{children}</AppShell>
      </ProjectProvider>
    </PlatformProvider>
  );
}
