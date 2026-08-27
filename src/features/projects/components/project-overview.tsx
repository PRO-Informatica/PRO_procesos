"use client";

import {
  Building2,
  CalendarClock,
  FolderOpen,
  KeyRound,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { motion } from "motion/react";

import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { MotionPage } from "@/components/motion/motion-page";
import { fadeUp, staggerContainer } from "@/lib/motion/variants";

import { useProjectContext } from "../project-context";

const statusLabels = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  CLOSED: "Cerrado",
};

export function ProjectOverview() {
  const context = useProjectContext();

  if (context.status === "error") {
    return (
      <ErrorState
        description={context.message}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!context.activeProject) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No tienes proyectos asignados"
        description="Tu cuenta está activa, pero todavía no tiene acceso a ningún proyecto. Solicita al administrador de tu empresa que configure tu membresía."
      />
    );
  }

  const project = context.activeProject;

  return (
    <MotionPage className="mx-auto max-w-6xl">
      <motion.section
        className="overflow-hidden rounded-2xl border border-border bg-surface"
        variants={fadeUp}
      >
        <div className="border-b border-border p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
                Proyecto activo
              </p>
              <h1 className="mt-3 truncate text-3xl font-semibold tracking-tight text-foreground">
                {project.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 aria-hidden="true" className="size-4" />
                  {project.companyName}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                  <MapPin aria-hidden="true" className="size-4" />
                  {project.code}
                </span>
              </div>
            </div>
            <span
              className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                project.status === "ACTIVE"
                  ? "bg-success-soft text-success"
                  : "bg-muted text-foreground-muted"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  project.status === "ACTIVE" ? "bg-success" : "bg-foreground-muted"
                }`}
              />
              {statusLabels[project.status]}
            </span>
          </div>
        </div>

        <motion.div
          className="grid gap-px bg-border sm:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <ProjectFact icon={CalendarClock} label="Zona horaria" value={project.timezone} />
          <ProjectFact
            icon={ShieldCheck}
            label="Roles activos"
            value={context.roleCodes.length ? context.roleCodes.join(" · ") : "Sin rol operativo"}
          />
          <ProjectFact
            icon={KeyRound}
            label="Permisos efectivos"
            value={`${context.permissions.length} habilitados`}
          />
        </motion.div>
      </motion.section>

      <motion.section
        className="mt-5 rounded-xl border border-dashed border-border bg-muted/40 p-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
      >
        <p className="text-sm font-semibold text-foreground">Contexto configurado</p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
          La navegación ya responde a los permisos efectivos de este proyecto. Los módulos operativos se habilitarán progresivamente en sus fases correspondientes; RLS continúa siendo la barrera final de seguridad.
        </p>
      </motion.section>
    </MotionPage>
  );
}

function ProjectFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
}) {
  return (
    <motion.div className="bg-surface p-5 sm:p-6" variants={fadeUp}>
      <Icon aria-hidden="true" className="size-5 text-brand-strong" />
      <p className="mt-4 text-xs font-medium text-foreground-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </p>
    </motion.div>
  );
}
