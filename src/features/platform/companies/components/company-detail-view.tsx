import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FolderKanban,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionSection } from "@/components/motion/motion-section";

import { formatDate } from "../formatters";
import type { CompanyDetail } from "../types";
import { CompanyStatusBadge } from "./company-status-badge";
import { CompanyStatusDialog } from "./company-status-dialog";
import { CreateProjectDialog } from "./create-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import { ProjectSupplierManager } from "./project-supplier-manager";

function RecordStatus({ status }: { status: string }) {
  const active = status === "ACTIVE";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-success-soft text-success"
          : "bg-muted text-foreground-muted"
      }`}
    >
      {status === "ACTIVE"
        ? "Activo"
        : status === "INACTIVE"
          ? "Inactivo"
          : status}
    </span>
  );
}

export function CompanyDetailView({ company }: { company: CompanyDetail }) {
  const activeUsers = company.users.filter((user) => user.active).length;
  const detailPath = `/platform/companies/${company.id}`;

  return (
    <div className="mx-auto max-w-[1320px]">
      <Link
        href="/platform/companies"
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Empresas
      </Link>

      <MotionSection className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {company.name}
                </h1>
                <CompanyStatusBadge status={company.status} />
              </div>
              <p className="mt-2 font-mono text-xs text-foreground-muted">
                {company.code}
              </p>
            </div>
          </div>
          <CompanyStatusDialog
            companyId={company.id}
            companyName={company.name}
            status={company.status}
            returnTo={detailPath}
          />
        </div>

        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <OverviewItem
            icon={FolderKanban}
            label="Proyectos"
            value={String(company.projects.length)}
          />
          <OverviewItem
            icon={Users}
            label="Usuarios activos"
            value={String(activeUsers)}
          />
          <OverviewItem
            icon={ShieldCheck}
            label="Company Admin"
            value={company.companyAdmins.join(", ") || "Sin administrador"}
          />
          <OverviewItem
            icon={CalendarDays}
            label="Creada"
            value={formatDate(company.createdAt)}
          />
        </div>
      </MotionSection>

      <MotionSection className="mt-6 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between border-b border-border pb-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Overview</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Información administrativa de la empresa.
            </p>
          </div>
        </div>
        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Nombre" value={company.name} />
          <DetailField label="Código" value={company.code} mono />
          <DetailField
            label="Estado"
            value={company.status === "ACTIVE" ? "Activa" : "Inactiva"}
          />
          <DetailField
            label="Fecha de creación"
            value={formatDate(company.createdAt, true)}
          />
          <DetailField
            label="Última actualización"
            value={formatDate(company.updatedAt, true)}
          />
          <DetailField
            label="Administradores actuales"
            value={company.companyAdmins.join(", ") || "Sin administrador"}
          />
        </dl>
      </MotionSection>

      <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="border-b border-border p-6 sm:px-8">
          <h2 className="text-lg font-semibold text-foreground">
            Proveedores por proyecto
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Selecciona uno o varios proveedores de la empresa para habilitarlos
            operacionalmente en cada proyecto.
          </p>
        </div>
        {company.projects.length ? (
          <ProjectSupplierManager
            companyId={company.id}
            projects={company.projects}
            suppliers={company.suppliers}
          />
        ) : (
          <div className="p-6 sm:p-8">
            <EmptyState
              title="Sin proyectos"
              description="Crea un proyecto antes de asignarle proveedores."
            />
          </div>
        )}
      </MotionSection>

      <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Proyectos</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Crea y consulta los proyectos registrados para esta empresa.
            </p>
          </div>
          <CreateProjectDialog
            companyId={company.id}
            companyName={company.name}
            disabled={company.status !== "ACTIVE"}
          />
        </div>
        {company.projects.length === 0 ? (
          <div className="p-6 sm:p-8">
            <EmptyState
              title="Sin proyectos"
              description="Esta empresa todavía no tiene proyectos registrados."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                <tr>
                  <th className="px-6 py-3.5 sm:px-8">Proyecto</th>
                  <th className="px-4 py-3.5">Código</th>
                  <th className="px-4 py-3.5">Estado</th>
                  <th className="px-4 py-3.5">Proveedores</th>
                  <th className="px-4 py-3.5">Zona horaria</th>
                  <th className="px-4 py-3.5">Inicio</th>
                  <th className="px-4 py-3.5">Fin estimado</th>
                  <th className="px-6 py-3.5 text-right sm:px-8">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {company.projects.map((project) => (
                  <tr key={project.id}>
                    <td className="px-6 py-4 text-sm font-semibold text-foreground sm:px-8">
                      {project.name}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-foreground-muted">
                      {project.code}
                    </td>
                    <td className="px-4 py-4">
                      <RecordStatus status={project.status} />
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-foreground">
                      {project.supplierIds.length}
                    </td>
                    <td className="px-4 py-4 text-sm text-foreground-muted">
                      {project.timezone}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-foreground-muted">
                      {formatDate(project.startDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-foreground-muted">
                      {formatDate(project.estimatedEndDate)}
                    </td>
                    <td className="px-6 py-4 text-right sm:px-8">
                      <EditProjectDialog
                        companyId={company.id}
                        project={project}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MotionSection>

      <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="border-b border-border p-6 sm:px-8">
          <h2 className="text-lg font-semibold text-foreground">Usuarios</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Membresías y roles de compañía. Vista de solo lectura.
          </p>
        </div>
        {company.users.length === 0 ? (
          <div className="p-6 sm:p-8">
            <EmptyState
              title="Sin usuarios vinculados"
              description="Esta empresa todavía no tiene membresías registradas."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                <tr>
                  <th className="px-6 py-3.5 sm:px-8">Usuario</th>
                  <th className="px-4 py-3.5">Membership</th>
                  <th className="px-4 py-3.5">Roles activos</th>
                  <th className="px-6 py-3.5 sm:px-8">Vinculado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {company.users.map((user) => (
                  <tr key={user.membershipId}>
                    <td className="px-6 py-4 sm:px-8">
                      <p className="text-sm font-semibold text-foreground">
                        {user.name}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-foreground-muted">
                        {user.userId}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          user.active
                            ? "bg-success-soft text-success"
                            : "bg-muted text-foreground-muted"
                        }`}
                      >
                        {user.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-foreground-muted">
                      {user.roles.length
                        ? user.roles.join(" · ")
                        : "Sin rol activo"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground-muted sm:px-8">
                      {formatDate(user.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  icon: typeof FolderKanban;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 bg-surface p-5 sm:p-6">
      <Icon aria-hidden="true" className="size-5 text-brand-strong" />
      <dt className="mt-3 text-xs font-medium text-foreground-muted">
        {label}
      </dt>
      <dd
        className="mt-1 truncate text-sm font-semibold text-foreground"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-foreground-muted">{label}</dt>
      <dd
        className={`mt-1.5 text-sm font-semibold text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
