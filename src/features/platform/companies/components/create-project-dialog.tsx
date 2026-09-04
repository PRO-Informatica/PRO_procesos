"use client";

import { FolderPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { useActionNotification } from "@/components/feedback/use-action-notification";
import { LoadingButton } from "@/components/feedback/loading-button";
import { useDialogAccessibility } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

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
  const dialogRef = useDialogAccessibility<HTMLElement>({ open, onClose: () => setOpen(false), pending });

  useActionNotification({ pending, status: state.status, success: notifications.projectCreated, error: notifications.saveFailed });

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
            className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-black/45 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-[max(.5rem,env(safe-area-inset-top))] sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pending)
                setOpen(false);
            }}
          >
            <motion.section
              ref={dialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-project-title"
              className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
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
                  className="grid size-11 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted"
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
                  <div>
                    <label className="form-label" htmlFor="project-billing-name">Razón social de facturación *</label>
                    <input id="project-billing-name" name="billingLegalName" required minLength={2} maxLength={200} defaultValue={state.fields?.billingLegalName} className="form-input" placeholder="Receptor de la factura" />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="project-billing-tax">NIT receptor *</label>
                    <input id="project-billing-tax" name="billingTaxId" required maxLength={40} defaultValue={state.fields?.billingTaxId} className="form-input" />
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
                <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:static sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
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
