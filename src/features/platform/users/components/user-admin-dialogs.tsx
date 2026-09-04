"use client";

import {
  Building2,
  FolderKanban,
  KeyRound,
  Pencil,
  Power,
  PowerOff,
  ShieldCheck,
} from "lucide-react";
import { motion } from "motion/react";
import { useActionState, useState } from "react";

import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Dialog } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import {
  assignPlatformCompany,
  assignPlatformProject,
  requestPlatformPasswordReset,
  setPlatformCompanyMembership,
  setPlatformCompanyRole,
  setPlatformProjectMembership,
  setPlatformProjectRole,
  setPlatformUserPassword,
  updatePlatformUserProfile,
} from "../actions";
import {
  initialPlatformUserActionState,
  type PlatformCompanyOption,
  type PlatformProjectOption,
  type PlatformRoleOption,
  type UserRoleAssignment,
} from "../types";

function ActionMessage({ state }: { state: typeof initialPlatformUserActionState }) {
  if (state.status !== "error") return null;

  return (
    <p
      className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {state.message}
    </p>
  );
}

function DialogFrame({
  open,
  onClose,
  title,
  description,
  icon,
  pending,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  icon: React.ReactNode;
  pending: boolean;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return <Dialog title={title} description={description} icon={icon} onClose={onClose} pending={pending} size={width === "max-w-2xl" ? "md" : "sm"}><div className="p-6">{children}</div></Dialog>;
}

function DialogButton({
  onClick,
  icon,
  children,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
      whileTap={disabled ? undefined : { scale: 0.98 }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export function EditUserDialog({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    updatePlatformUserProfile,
    initialPlatformUserActionState,
  );
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <>
      <DialogButton onClick={() => setOpen(true)} icon={<Pencil className="size-3.5" />}>
        Editar información
      </DialogButton>
      <DialogFrame
        open={open}
        onClose={() => setOpen(false)}
        pending={pending}
        title="Editar información"
        description="El nombre se guarda en el perfil operativo de la plataforma."
        icon={<Pencil className="size-5" />}
      >
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="userId" value={userId} />
          <div>
            <label htmlFor={`full-name-${userId}`} className="form-label">Nombre completo</label>
            <input
              id={`full-name-${userId}`}
              name="fullName"
              defaultValue={state.fields?.fullName ?? fullName}
              required
              minLength={2}
              maxLength={160}
              className="form-input"
              autoComplete="name"
            />
          </div>
          <ActionMessage state={state} />
          <div className="flex justify-end gap-3 border-t border-border pt-5">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cerrar</button>
            {state.status !== "success" && <button type="submit" disabled={pending} className="primary-button">Guardar cambios</button>}
          </div>
        </form>
      </DialogFrame>
    </>
  );
}

function RecoveryEmailForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    requestPlatformPasswordReset,
    initialPlatformUserActionState,
  );
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.actionFailed });

  return (
    <form action={formAction} className="rounded-xl border border-border p-4">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm font-semibold text-foreground">Enviar enlace de recuperación</p>
      <p className="mt-1 text-xs leading-5 text-foreground-muted">Opción recomendada: el usuario define su propia contraseña.</p>
      <div className="mt-4"><ActionMessage state={state} /></div>
      {state.status !== "success" && <button type="submit" disabled={pending} className="primary-button mt-4 w-full">Enviar enlace</button>}
    </form>
  );
}

function AdminPasswordForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    setPlatformUserPassword,
    initialPlatformUserActionState,
  );
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-border p-4">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <p className="text-sm font-semibold text-foreground">Establecer nueva contraseña</p>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">Nunca se muestra ni almacena la contraseña actual.</p>
      </div>
      <div>
        <label className="form-label" htmlFor={`admin-password-${userId}`}>Nueva contraseña</label>
        <input id={`admin-password-${userId}`} name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" className="form-input" />
      </div>
      <div>
        <label className="form-label" htmlFor={`admin-password-confirm-${userId}`}>Confirmar contraseña</label>
        <input id={`admin-password-confirm-${userId}`} name="passwordConfirmation" type="password" minLength={8} maxLength={128} required autoComplete="new-password" className="form-input" />
      </div>
      <ActionMessage state={state} />
      {state.status !== "success" && <button type="submit" disabled={pending} className="primary-button w-full">Establecer contraseña</button>}
    </form>
  );
}

export function PasswordManagementDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DialogButton onClick={() => setOpen(true)} icon={<KeyRound className="size-3.5" />}>
        Contraseña
      </DialogButton>
      <DialogFrame
        open={open}
        onClose={() => setOpen(false)}
        pending={false}
        title="Administrar contraseña"
        description="Usa recuperación por correo o establece una contraseña administrativa cuando el proceso lo requiera."
        icon={<KeyRound className="size-5" />}
        width="max-w-2xl"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <RecoveryEmailForm userId={userId} />
          <AdminPasswordForm userId={userId} />
        </div>
      </DialogFrame>
    </>
  );
}

export function AssignCompanyDialog({
  userId,
  companies,
  roles,
  disabled,
}: {
  userId: string;
  companies: PlatformCompanyOption[];
  roles: PlatformRoleOption[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(assignPlatformCompany, initialPlatformUserActionState);
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <>
      <DialogButton disabled={disabled || companies.length === 0} onClick={() => setOpen(true)} icon={<Building2 className="size-3.5" />}>Asignar empresa</DialogButton>
      <DialogFrame open={open} onClose={() => setOpen(false)} pending={pending} title="Asignar empresa" description="La membership no concede Company Admin automáticamente; selecciona roles solo si corresponde." icon={<Building2 className="size-5" />}>
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="userId" value={userId} />
          <div>
            <label htmlFor={`assign-company-${userId}`} className="form-label">Empresa</label>
            <select id={`assign-company-${userId}`} name="companyId" defaultValue={state.fields?.companyId ?? ""} required className="form-input">
              <option value="" disabled>Selecciona una empresa activa</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name} · {company.code}</option>)}
            </select>
          </div>
          <RoleCheckboxes roles={roles} />
          <ActionMessage state={state} />
          <div className="flex justify-end gap-3 border-t border-border pt-5">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cerrar</button>
            {state.status !== "success" && <button type="submit" disabled={pending} className="primary-button">Asignar empresa</button>}
          </div>
        </form>
      </DialogFrame>
    </>
  );
}

function RoleCheckboxes({ roles }: { roles: PlatformRoleOption[] }) {
  if (roles.length === 0) return <p className="text-sm text-foreground-muted">No hay roles activos disponibles para este ámbito.</p>;
  return (
    <fieldset>
      <legend className="form-label">Roles opcionales</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((role) => (
          <label key={role.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm hover:bg-muted/50">
            <input type="checkbox" name="roleIds" value={role.id} className="mt-0.5 size-4 accent-[var(--brand)]" />
            <span><strong className="block text-foreground">{role.name}</strong><span className="text-xs text-foreground-muted">{role.code}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AssignProjectDialog({
  userId,
  companies,
  projects,
  roles,
  disabled,
}: {
  userId: string;
  companies: PlatformCompanyOption[];
  projects: PlatformProjectOption[];
  roles: PlatformRoleOption[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [state, formAction, pending] = useActionState(assignPlatformProject, initialPlatformUserActionState);
  const filteredProjects = projects.filter((project) => project.companyId === companyId);
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <>
      <DialogButton disabled={disabled || companies.length === 0} onClick={() => setOpen(true)} icon={<FolderKanban className="size-3.5" />}>Asignar proyecto</DialogButton>
      <DialogFrame open={open} onClose={() => setOpen(false)} pending={pending} title="Asignar proyecto" description="Selecciona primero la empresa. La disponibilidad se valida al guardar." icon={<FolderKanban className="size-5" />} width="max-w-2xl">
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="userId" value={userId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`project-company-${userId}`} className="form-label">Empresa *</label>
              <select id={`project-company-${userId}`} name="companyId" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setProjectId(""); }} required className="form-input">
                <option value="" disabled>Selecciona una empresa</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name} · {company.code}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`project-project-${userId}`} className="form-label">Proyecto *</label>
              <select id={`project-project-${userId}`} name="projectId" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!companyId} required className="form-input disabled:cursor-not-allowed disabled:opacity-55">
                <option value="" disabled>{companyId ? "Selecciona un proyecto" : "Selecciona primero una empresa"}</option>
                {filteredProjects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}
              </select>
            </div>
          </div>
          {companyId && filteredProjects.length === 0 && <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground-muted">Esta empresa no tiene proyectos activos disponibles.</p>}
          <RoleCheckboxes roles={roles} />
          <ActionMessage state={state} />
          <div className="flex justify-end gap-3 border-t border-border pt-5">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cerrar</button>
            {state.status !== "success" && <button type="submit" disabled={pending || !projectId} className="primary-button">Asignar proyecto</button>}
          </div>
        </form>
      </DialogFrame>
    </>
  );
}

export function MembershipStatusDialog({
  scope,
  userId,
  companyId,
  projectId,
  label,
  active,
}: {
  scope: "COMPANY" | "PROJECT";
  userId: string;
  companyId: string;
  projectId?: string;
  label: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const action = scope === "COMPANY" ? setPlatformCompanyMembership : setPlatformProjectMembership;
  const [state, formAction, pending] = useActionState(action, initialPlatformUserActionState);
  const activating = !active;
  useActionNotification({ pending, status: state.status, success: notifications.statusUpdated, error: notifications.actionFailed });

  return (
    <>
      <DialogButton onClick={() => setOpen(true)} icon={activating ? <Power className="size-3.5" /> : <PowerOff className="size-3.5" />}>{activating ? "Reactivar" : "Desactivar relación"}</DialogButton>
      <DialogFrame open={open} onClose={() => setOpen(false)} pending={pending} title={activating ? "Reactivar relación" : "Desactivar relación"} description={activating ? "Se reactivará únicamente la membership. Los roles históricos no se restaurarán." : scope === "COMPANY" ? "Se revocarán los roles activos de empresa y proyecto, y se desactivarán los proyectos activos de esta empresa. Todo el historial se conservará." : "Se revocarán los roles activos de este proyecto y se conservará todo el historial."} icon={activating ? <Power className="size-5" /> : <PowerOff className="size-5" />}>
        <p className="rounded-lg bg-muted px-4 py-3 text-sm font-semibold text-foreground">{label}</p>
        <ActionMessage state={state} />
        <form action={formAction} className="mt-5 flex justify-end gap-3 border-t border-border pt-5">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="companyId" value={companyId} />
          {projectId && <input type="hidden" name="projectId" value={projectId} />}
          <input type="hidden" name="active" value={String(activating)} />
          <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cancelar</button>
          {state.status !== "success" && <button type="submit" disabled={pending} className={activating ? "primary-button" : "rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white"}>{activating ? "Reactivar" : "Desactivar"}</button>}
        </form>
      </DialogFrame>
    </>
  );
}

function RoleToggleForm({
  scope,
  userId,
  membershipId,
  role,
  assignment,
  membershipActive,
}: {
  scope: "COMPANY" | "PROJECT";
  userId: string;
  membershipId: string;
  role: PlatformRoleOption;
  assignment?: UserRoleAssignment;
  membershipActive: boolean;
}) {
  const action = scope === "COMPANY" ? setPlatformCompanyRole : setPlatformProjectRole;
  const [state, formAction, pending] = useActionState(action, initialPlatformUserActionState);
  const assigned = Boolean(assignment);
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <form action={formAction} className="rounded-lg border border-border p-3">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="roleId" value={role.id} />
      <input type="hidden" name="assignmentId" value={assignment?.assignmentId ?? ""} />
      <input type="hidden" name="active" value={String(!assigned)} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{role.name}</p>
          <p className="mt-0.5 text-xs text-foreground-muted">{role.code}</p>
        </div>
        <button type="submit" disabled={pending || (!membershipActive && !assigned)} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${assigned ? "border border-destructive/25 text-destructive hover:bg-destructive-soft" : "border border-border text-foreground-muted hover:bg-muted"}`}>{assigned ? "Revocar" : "Asignar"}</button>
      </div>
      {state.status !== "idle" && <p className={`mt-2 text-xs ${state.status === "success" ? "text-success" : "text-destructive"}`}>{state.message}</p>}
    </form>
  );
}

export function ManageRolesDialog({
  scope,
  userId,
  membershipId,
  label,
  membershipActive,
  roles,
  assignments,
}: {
  scope: "COMPANY" | "PROJECT";
  userId: string;
  membershipId: string;
  label: string;
  membershipActive: boolean;
  roles: PlatformRoleOption[];
  assignments: UserRoleAssignment[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DialogButton onClick={() => setOpen(true)} icon={<ShieldCheck className="size-3.5" />}>Gestionar roles</DialogButton>
      <DialogFrame open={open} onClose={() => setOpen(false)} pending={false} title="Gestionar roles" description={`Roles ${scope} activos para ${label}. Las revocaciones permanecen en el historial.`} icon={<ShieldCheck className="size-5" />}>
        {!membershipActive && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm text-foreground-muted">Reactiva la membership antes de asignar roles nuevos.</p>}
        <div className="space-y-2">
          {roles.map((role) => (
            <RoleToggleForm key={role.id} scope={scope} userId={userId} membershipId={membershipId} role={role} assignment={assignments.find((assignment) => assignment.roleId === role.id && assignment.active)} membershipActive={membershipActive} />
          ))}
        </div>
        <div className="mt-5 flex justify-end border-t border-border pt-5"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cerrar</button></div>
      </DialogFrame>
    </>
  );
}
