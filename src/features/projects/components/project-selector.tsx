"use client";

import { Building2, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";

import { switchProject } from "../actions";
import { useProjectContext } from "../project-context";

const initialState = { status: "idle" as const };

export function ProjectSelector({ collapsed = false }: { collapsed?: boolean }) {
  const context = useProjectContext();
  const [state, formAction, pending] = useActionState(switchProject, initialState);
  useGlobalPending(
    pending,
    "Cambiando proyecto…",
    "Estamos actualizando tu contexto operacional.",
  );

  if (context.status === "error") {
    return (
      <div
        className={`rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-white/70 ${
          collapsed ? "text-center" : ""
        }`}
        title={context.message}
      >
        <Building2 aria-hidden="true" className="mx-auto size-4 text-destructive" />
        {!collapsed && <span className="mt-2 block">Error al cargar proyectos</span>}
      </div>
    );
  }

  if (!context.activeProject) {
    return (
      <div
        className={`rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/45 ${
          collapsed ? "text-center" : ""
        }`}
      >
        <Building2 aria-hidden="true" className="mx-auto size-4" />
        {!collapsed && <span className="mt-2 block">Sin proyectos asignados</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="relative">
      {collapsed ? (
        <div
          className="grid size-11 place-items-center rounded-lg border border-white/10 bg-white/5 text-brand"
          title={`${context.activeProject.name} · ${context.activeProject.companyName}`}
        >
          <Building2 aria-hidden="true" className="size-4" />
        </div>
      ) : (
        <motion.div layout className="relative">
          <Building2
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-brand"
          />
          <select
            name="projectId"
            value={context.activeProject.id}
            disabled={pending || context.projects.length < 2}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="h-14 w-full appearance-none rounded-lg border border-white/10 bg-white/5 pl-10 pr-9 text-xs font-medium text-white outline-none transition-colors hover:bg-white/8 disabled:cursor-default"
            aria-label="Proyecto activo"
          >
            {context.projects.map((project) => (
              <option key={project.id} value={project.id} className="bg-sidebar text-white">
                {project.name} · {project.code}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-white/45"
          />
        </motion.div>
      )}

      <AnimatePresence>
        {state.status === "error" && !collapsed && (
          <motion.p
            className="mt-2 text-[11px] leading-4 text-destructive"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
          >
            {state.message}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}
