import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { NotificationsCenter } from "@/features/notifications/components/notifications-center";
import { getOperationalNotifications } from "@/features/notifications/queries";
import { getProjectContext } from "@/features/projects/queries";
import { canAccessOperationalSection } from "@/features/projects/access-policy";

export default async function NotificationsPage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!canAccessOperationalSection(context.roleCodes, "/notifications")) return <EmptyState title="Sin acceso a Notificaciones" description="Esta sección no está disponible para tu rol." />;
  if (!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar Notificaciones." />;
  const notifications = await getOperationalNotifications({ projectId: context.activeProject.id, projectName: context.activeProject.name, timezone: context.activeProject.timezone, userId: profile.id, permissions: context.permissions });
  return <NotificationsCenter notifications={notifications} projectId={context.activeProject.id} timezone={context.activeProject.timezone} />;
}
