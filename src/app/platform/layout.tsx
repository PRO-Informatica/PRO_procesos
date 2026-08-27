import { redirect } from "next/navigation";

import { requireActiveProfile } from "@/features/auth/queries";
import { PlatformShell } from "@/features/platform/components/platform-shell";
import { PlatformProvider } from "@/features/platform/platform-context";
import { isPlatformAdmin } from "@/features/platform/queries";
import { getProjectContext } from "@/features/projects/queries";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireActiveProfile();
  const [platformAdmin, projectContext] = await Promise.all([
    isPlatformAdmin(profile.id),
    getProjectContext(profile.id),
  ]);

  if (!platformAdmin) {
    redirect("/");
  }

  return (
    <PlatformProvider
      value={{
        isPlatformAdmin: true,
        hasOperationalAccess: projectContext.status === "ready",
      }}
    >
      <PlatformShell profile={profile}>{children}</PlatformShell>
    </PlatformProvider>
  );
}
