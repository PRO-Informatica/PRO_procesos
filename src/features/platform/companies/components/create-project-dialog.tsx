"use client";

import { FolderPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { LoadingButton } from "@/components/feedback/loading-button";

import { createCompanyProject } from "../actions";
import type { ProjectActionState } from "../types";

const INITIAL_PROJECT_ACTION_STATE: ProjectActionState = { status: "idle" };

const TIMEZONES = [
  "America/Guatemala",
  "America/Belize",
  "America/Costa_Rica",
  "America/El_Salvador",
  "America/Tegucigalpa",
  "America/Managua",
  "America/Panama",
  "America/Bogota",
  "America/Mexico_City",
  "UTC",
];

export function CreateProjectDialog({
  companyId,
  companyName,
  disabled = false,
}: {
  companyId: string;
  companyName: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [actionState, action, pending] = useActionState(
    createCompanyProject,
    INITIAL_PROJECT_ACTION_STATE,
  );
  const state = actionState ?? INITIAL_PROJECT_ACTION_STATE;

  useGlobalPending(
    pending,
    "Creando proyecto…",
    `Registrando el nuevo proyecto de ${companyName}.`,
  );

  return (
    <>
      <motion.button
        type="button"
        className="primary-button shrink-0"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={
          disabled ? "Activa la empresa antes de crear proyectos." : undefined
        }
        whileTap={disabled ? undefined : { scale: 0.98 }}
      >
        <FolderPlus aria-hidden="true" className="size-4" />
        Crear proyecto
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-black/45 p-3 sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pending)
                setOpen(false);
            }}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-project-title"
              className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              initial={{ opacity: 0, scale: 0.98, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.99, y: 3 }}
            >
              <div className="flex items-start gap-4 border-b border-border p-5 sm:p-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                  <FolderPlus aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    id="create-project-title"
                    className="text-lg font-semibold"
                  >
                    Crear proyecto
                  </h2>
                  <p className="mt-1 text-sm text-foreground-muted">
                    Nuevo proyecto activo para {companyName}.
                  </p>
                </div>
                <button
                  type="button"
                  className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  aria-label="Cerrar"
                >
                  <X className="size-5" />
                </button>
              </div>

              <form action={action}>
                <input type="hidden" name="companyId" value={companyId} />
                <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
                  <div>
                    <label className="form-label" htmlFor="project-name">
                      Nombre *
                    </label>
                    <input
                      id="project-name"
                      name="name"
                      required
                      minLength={2}
                      maxLength={160}
                      defaultValue={state.fields?.name}
                      className="form-input"
                      placeholder="Ej. Proyecto Zona Norte"
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="project-code">
                      Código *
                    </label>
                    <input
                      id="project-code"
                      name="code"
                      required
                      minLength={2}
                      maxLength={40}
                      defaultValue={state.fields?.code}
                      className="form-input font-mono uppercase"
                      placeholder="Ej. LAS CAMPANELAS, S. A."
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="form-label" htmlFor="project-address">
                      Dirección
                    </label>
                    <input
                      id="project-address"
                      name="address"
                      maxLength={300}
                      defaultValue={state.fields?.address}
                      className="form-input"
                      placeholder="Ubicación o dirección del proyecto"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="form-label" htmlFor="project-timezone">
                      Zona horaria *
                    </label>
                    <select
                      id="project-timezone"
                      name="timezone"
                      required
                      defaultValue={
                        state.fields?.timezone ?? "America/Guatemala"
                      }
                      className="form-input"
                    >
                      {TIMEZONES.map((timezone) => (
                        <option key={timezone} value={timezone}>
                          {timezone}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="project-start-date">
                      Fecha de inicio
                    </label>
                    <input
                      id="project-start-date"
                      name="startDate"
                      type="date"
                      defaultValue={state.fields?.startDate}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="project-end-date">
                      Finalización estimada
                    </label>
                    <input
                      id="project-end-date"
                      name="estimatedEndDate"
                      type="date"
                      defaultValue={state.fields?.estimatedEndDate}
                      className="form-input"
                    />
                  </div>
                  {state.status === "error" && (
                    <p
                      role="alert"
                      className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive sm:col-span-2"
                    >
                      {state.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setOpen(false)}
                    disabled={pending}
                  >
                    Cancelar
                  </button>
                  <LoadingButton loadingLabel="Creando…">
                    Crear proyecto
                  </LoadingButton>
                </div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
