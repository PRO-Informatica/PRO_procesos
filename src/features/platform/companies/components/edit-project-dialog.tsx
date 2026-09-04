"use client";

import { Pencil, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { useActionNotification } from "@/components/feedback/use-action-notification";
import { LoadingButton } from "@/components/feedback/loading-button";
import { useDialogAccessibility } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { updateCompanyProject } from "../actions";
import type { CompanyProject, ProjectActionState } from "../types";

const INITIAL_STATE: ProjectActionState = { status: "idle" };

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

function EditProjectForm({
  companyId,
  project,
  onClose,
}: {
  companyId: string;
  project: CompanyProject;
  onClose: () => void;
}) {
  const [actionState, action, pending] = useActionState(
    updateCompanyProject,
    INITIAL_STATE,
  );
  const state = actionState ?? INITIAL_STATE;
  const values = state.fields;
  const dialogRef = useDialogAccessibility<HTMLElement>({ open: true, onClose, pending });

  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <motion.div
      className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-black/45 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-[max(.5rem,env(safe-area-inset-top))] sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <motion.section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`edit-project-title-${project.id}`}
        className="my-auto max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
        initial={{ opacity: 0, scale: 0.98, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.99, y: 3 }}
      >
        <div className="flex items-start gap-4 border-b border-border p-5 sm:p-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
            <Pencil aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id={`edit-project-title-${project.id}`}
              className="text-lg font-semibold text-foreground"
            >
              Editar proyecto
            </h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Actualiza la información administrativa de {project.name}.
            </p>
          </div>
          <button
            type="button"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted disabled:opacity-50"
            onClick={onClose}
            disabled={pending}
            aria-label="Cerrar edición"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <form action={action}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="projectId" value={project.id} />
          <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <div>
              <label className="form-label" htmlFor={`edit-project-name-${project.id}`}>
                Nombre *
              </label>
              <input
                id={`edit-project-name-${project.id}`}
                name="name"
                required
                minLength={2}
                maxLength={160}
                defaultValue={values?.name ?? project.name}
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label" htmlFor={`edit-project-code-${project.id}`}>
                Código *
              </label>
              <input
                id={`edit-project-code-${project.id}`}
                name="code"
                required
                minLength={2}
                maxLength={40}
                defaultValue={values?.code ?? project.code}
                className="form-input font-mono uppercase"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="form-label" htmlFor={`edit-project-address-${project.id}`}>
                Dirección
              </label>
              <input
                id={`edit-project-address-${project.id}`}
                name="address"
                maxLength={300}
                defaultValue={values?.address ?? project.address ?? ""}
                className="form-input"
                placeholder="Ubicación o dirección del proyecto"
              />
            </div>
            <div>
              <label className="form-label" htmlFor={`edit-project-billing-name-${project.id}`}>Razón social de facturación *</label>
              <input id={`edit-project-billing-name-${project.id}`} name="billingLegalName" required minLength={2} maxLength={200} defaultValue={values?.billingLegalName ?? project.billingLegalName ?? ""} className="form-input" placeholder="Receptor de la factura" />
            </div>
            <div>
              <label className="form-label" htmlFor={`edit-project-billing-tax-${project.id}`}>NIT receptor *</label>
              <input id={`edit-project-billing-tax-${project.id}`} name="billingTaxId" required maxLength={40} defaultValue={values?.billingTaxId ?? project.billingTaxId ?? ""} className="form-input" />
            </div>
            <div>
              <label className="form-label" htmlFor={`edit-project-timezone-${project.id}`}>
                Zona horaria *
              </label>
              <select
                id={`edit-project-timezone-${project.id}`}
                name="timezone"
                required
                defaultValue={values?.timezone ?? project.timezone}
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
              <label className="form-label" htmlFor={`edit-project-status-${project.id}`}>
                Estado *
              </label>
              <select
                id={`edit-project-status-${project.id}`}
                name="status"
                required
                defaultValue={values?.status ?? project.status}
                className="form-input"
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
                <option value="CLOSED">Cerrado</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor={`edit-project-start-${project.id}`}>
                Fecha de inicio
              </label>
              <input
                id={`edit-project-start-${project.id}`}
                name="startDate"
                type="date"
                defaultValue={values?.startDate ?? project.startDate ?? ""}
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label" htmlFor={`edit-project-end-${project.id}`}>
                Finalización estimada
              </label>
              <input
                id={`edit-project-end-${project.id}`}
                name="estimatedEndDate"
                type="date"
                defaultValue={values?.estimatedEndDate ?? project.estimatedEndDate ?? ""}
                className="form-input"
              />
            </div>

            {state.status !== "idle" && (
              <p
                role={state.status === "error" ? "alert" : "status"}
                className={`rounded-lg px-4 py-3 text-sm sm:col-span-2 ${
                  state.status === "success"
                    ? "bg-success-soft text-success"
                    : "bg-destructive-soft text-destructive"
                }`}
              >
                {state.message}
              </p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={pending}
            >
              {state.status === "success" ? "Cerrar" : "Cancelar"}
            </button>
            {state.status !== "success" && (
              <LoadingButton loadingLabel="Guardando…">Guardar cambios</LoadingButton>
            )}
          </div>
        </form>
      </motion.section>
    </motion.div>
  );
}

export function EditProjectDialog({
  companyId,
  project,
}: {
  companyId: string;
  project: CompanyProject;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
      >
        <Pencil aria-hidden="true" className="size-3.5" />
        Editar
      </button>
      <AnimatePresence>
        {open && (
          <EditProjectForm
            key={`${project.id}-${project.name}-${project.code}-${project.status}`}
            companyId={companyId}
            project={project}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
