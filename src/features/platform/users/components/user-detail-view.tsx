import {
  Activity,
  ArrowLeft,
  Building2,
  CalendarDays,
  Clock3,
  FolderKanban,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionSection } from "@/components/motion/motion-section";

import { authStatusLabel, formatUserDate } from "../formatters";
import type {
  PlatformUserDetail,
  UserRoleAssignment,
} from "../types";
import {
  AssignCompanyDialog,
  AssignProjectDialog,
  EditUserDialog,
  ManageRolesDialog,
  MembershipStatusDialog,
  PasswordManagementDialog,
} from "./user-admin-dialogs";
import { UserAvatar } from "./user-avatar";
import {
  UserProfileStatusBadge,
} from "./user-status-badge";
import { UserStatusDialog } from "./user-status-dialog";

function RoleTags({ roles }: { roles: UserRoleAssignment[] }) {
  if (roles.length === 0) {
    return <span className="text-sm text-foreground-muted">Sin roles asignados</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {roles.map((role) => (
        <span
          key={role.assignmentId}
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
            role.active
              ? "bg-brand-soft text-brand-strong"
              : "bg-muted text-foreground-muted line-through"
          }`}
          title={
            role.active
              ? `Asignado ${formatUserDate(role.assignedAt)}`
              : `Revocado ${formatUserDate(role.revokedAt)}`
          }
        >
          {role.roleName}
        </span>
      ))}
    </div>
  );
}

function MembershipRoles({ roles }: { roles: UserRoleAssignment[] }) {
  const active = roles.filter((role) => role.active);
  const historical = roles.filter((role) => !role.active);

  return (
    <div className="space-y-2">
      <RoleTags roles={active} />
      {historical.length > 0 && (
        <details className="text-xs text-foreground-muted">
          <summary className="cursor-pointer font-semibold">Historial ({historical.length})</summary>
          <div className="mt-2"><RoleTags roles={historical} /></div>
        </details>
      )}
    </div>
  );
}

function MembershipBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-success-soft text-success"
          : "bg-muted text-foreground-muted"
      }`}
    >
      {active ? "Membership activo" : "Membership inactivo"}
    </span>
  );
}

export function UserDetailView({ user }: { user: PlatformUserDetail }) {
  const activeCompanyMemberships = user.companyMemberships.filter(
    (membership) => membership.active,
  ).length;
  const activeProjectMemberships = user.projectMemberships.filter(
    (membership) => membership.active,
  ).length;

  return (
    <div className="mx-auto max-w-[1320px]">
      <Link
        href="/platform/users"
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Usuarios
      </Link>

      <MotionSection className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <UserAvatar name={user.fullName} avatarUrl={user.avatarUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {user.fullName}
                </h1>
                <UserProfileStatusBadge active={user.profileActive} />
              </div>
              <p className="mt-2 break-all text-sm text-foreground-muted">{user.email}</p>
              {user.isPlatformAdmin && (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                  PLATFORM_ADMIN
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <EditUserDialog
              key={`${user.id}-${user.fullName}`}
              userId={user.id}
              fullName={user.fullName}
            />
            <PasswordManagementDialog userId={user.id} />
            <UserStatusDialog
              key={`${user.id}-${user.profileActive ? "active" : "inactive"}`}
              userId={user.id}
              userName={user.fullName}
              active={user.profileActive}
              disabled={user.isCurrentUser && user.profileActive}
            />
          </div>
        </div>

        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <OverviewItem
            icon={Building2}
            label="Empresas activas"
            value={String(activeCompanyMemberships)}
          />
          <OverviewItem
            icon={FolderKanban}
            label="Proyectos activos"
            value={String(activeProjectMemberships)}
          />
          <OverviewItem
            icon={Mail}
            label="Estado de email"
            value={authStatusLabel(user.authStatus)}
          />
          <OverviewItem
            icon={Clock3}
            label="Último acceso"
            value={formatUserDate(user.lastSignInAt, true)}
          />
        </div>
      </MotionSection>

      <MotionSection className="mt-6 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <div className="border-b border-border pb-5">
          <h2 className="text-lg font-semibold text-foreground">Información general</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Datos sanitizados provenientes de Auth Admin y del profile público.
          </p>
        </div>
        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Nombre" value={user.fullName} />
          <DetailField label="Email" value={user.email} />
          <DetailField
            label="Estado funcional"
            value={user.profileActive ? "Activo" : "Inactivo"}
          />
          <DetailField
            label="Email confirmado"
            value={formatUserDate(user.emailConfirmedAt, true)}
          />
          <DetailField label="Creado en Auth" value={formatUserDate(user.createdAt, true)} />
          <DetailField
            label="Profile actualizado"
            value={formatUserDate(user.profileUpdatedAt, true)}
          />
        </dl>
        <p className="mt-6 rounded-xl border border-border bg-muted/45 px-4 py-3 text-xs leading-5 text-foreground-muted">
          PLATFORM_ADMIN es una capacidad global separada. No concede roles operativos de proyecto.
        </p>
      </MotionSection>

      <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <SectionHeading
          title="Empresas"
          description="Memberships de empresa y roles activos o históricos."
          action={
            <AssignCompanyDialog
              userId={user.id}
              companies={user.companyOptions}
              roles={user.companyRoleOptions}
              disabled={!user.profileActive}
            />
          }
        />
        {user.companyMemberships.length === 0 ? (
          <div className="p-6 sm:p-8">
            <EmptyState
              title="Sin empresas"
              description="Este usuario todavía no pertenece a ninguna empresa."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left">
              <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                <tr>
                  <th className="px-6 py-3.5 sm:px-8">Empresa</th>
                  <th className="px-4 py-3.5">Membership</th>
                  <th className="px-4 py-3.5">Roles</th>
                  <th className="px-6 py-3.5 sm:px-8">Vinculado</th>
                  <th className="px-6 py-3.5 text-right sm:px-8">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {user.companyMemberships.map((membership) => (
                  <tr key={membership.membershipId} className="hover:bg-muted/35">
                    <td className="px-6 py-4 sm:px-8">
                      <p className="text-sm font-semibold text-foreground">
                        {membership.companyName}
                      </p>
                      <p className="mt-1 font-mono text-xs text-foreground-muted">
                        {membership.companyCode}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <MembershipBadge active={membership.active} />
                    </td>
                    <td className="px-4 py-4">
                      <MembershipRoles roles={membership.roles} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground-muted sm:px-8">
                      {formatUserDate(membership.createdAt)}
                    </td>
                    <td className="px-6 py-4 sm:px-8">
                      <div className="flex justify-end gap-2">
                        <ManageRolesDialog
                          scope="COMPANY"
                          userId={user.id}
                          membershipId={membership.membershipId}
                          label={membership.companyName}
                          membershipActive={membership.active}
                          roles={user.companyRoleOptions}
                          assignments={membership.roles}
                        />
                        <MembershipStatusDialog
                          key={`${membership.membershipId}-${membership.active ? "active" : "inactive"}`}
                          scope="COMPANY"
                          userId={user.id}
                          companyId={membership.companyId}
                          label={membership.companyName}
                          active={membership.active}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MotionSection>

      <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <SectionHeading
          title="Proyectos"
          description="Memberships de proyecto sin mezclar el acceso global de plataforma."
          action={
            <AssignProjectDialog
              userId={user.id}
              companies={user.companyOptions}
              projects={user.projectOptions}
              roles={user.projectRoleOptions}
              disabled={!user.profileActive}
            />
          }
        />
        {user.projectMemberships.length === 0 ? (
          <div className="p-6 sm:p-8">
            <EmptyState
              title="Sin proyectos"
              description="Este usuario todavía no tiene memberships de proyecto."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                <tr>
                  <th className="px-6 py-3.5 sm:px-8">Proyecto</th>
                  <th className="px-4 py-3.5">Empresa</th>
                  <th className="px-4 py-3.5">Membership</th>
                  <th className="px-4 py-3.5">Roles</th>
                  <th className="px-6 py-3.5 sm:px-8">Vinculado</th>
                  <th className="px-6 py-3.5 text-right sm:px-8">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {user.projectMemberships.map((membership) => (
                  <tr key={membership.membershipId} className="hover:bg-muted/35">
                    <td className="px-6 py-4 sm:px-8">
                      <p className="text-sm font-semibold text-foreground">
                        {membership.projectName}
                      </p>
                      <p className="mt-1 font-mono text-xs text-foreground-muted">
                        {membership.projectCode}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-foreground-muted">
                      {membership.companyName}
                    </td>
                    <td className="px-4 py-4">
                      <MembershipBadge active={membership.active} />
                    </td>
                    <td className="px-4 py-4">
                      <MembershipRoles roles={membership.roles} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground-muted sm:px-8">
                      {formatUserDate(membership.createdAt)}
                    </td>
                    <td className="px-6 py-4 sm:px-8">
                      <div className="flex justify-end gap-2">
                        <ManageRolesDialog
                          scope="PROJECT"
                          userId={user.id}
                          membershipId={membership.membershipId}
                          label={membership.projectName}
                          membershipActive={membership.active}
                          roles={user.projectRoleOptions}
                          assignments={membership.roles}
                        />
                        <MembershipStatusDialog
                          key={`${membership.membershipId}-${membership.active ? "active" : "inactive"}`}
                          scope="PROJECT"
                          userId={user.id}
                          companyId={membership.companyId}
                          projectId={membership.projectId}
                          label={membership.projectName}
                          active={membership.active}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MotionSection>

      <MotionSection className="mt-6 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-foreground-muted">
            <Activity aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Actividad relevante</h2>
            <p className="mt-1 text-sm text-foreground-muted">Últimos eventos visibles relacionados con el usuario.</p>
          </div>
        </div>
        {user.auditEvents.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-muted/35 px-4 py-8 text-center text-sm text-foreground-muted">
            No hay eventos relevantes registrados.
          </p>
        ) : (
          <ol className="mt-6 divide-y divide-border">
            {user.auditEvents.map((event) => (
              <li key={event.id} className="flex flex-col gap-1 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {event.action.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-xs text-foreground-muted">{event.entityType}</p>
                </div>
                <time className="text-xs text-foreground-muted">
                  {formatUserDate(event.createdAt, true)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </MotionSection>
    </div>
  );
}

function OverviewItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 bg-surface p-5 sm:p-6">
      <Icon aria-hidden="true" className="size-5 text-brand-strong" />
      <dt className="mt-3 text-xs font-medium text-foreground-muted">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-foreground-muted">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-foreground-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
