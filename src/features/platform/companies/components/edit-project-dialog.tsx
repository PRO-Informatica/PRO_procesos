"use client";

import { Pencil } from "lucide-react";
import { useActionState, useState } from "react";

import { useActionNotification } from "@/components/feedback/use-action-notification";
import { LoadingButton } from "@/components/feedback/loading-button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
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
  useActionNotification({ pending, status: state.status, success: notifications.changesSaved, error: notifications.saveFailed });

  return (
    <Dialog
      title="Editar proyecto"
      description={`Actualiza la información administrativa de ${project.name}.`}
      icon={Pencil}
      onClose={onClose}
      pending={pending}
      size="md"
    >
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
                Dirección exacta de Obra *
              </label>
              <input
                id={`edit-project-address-${project.id}`}
                name="address"
                required
                minLength={5}
                maxLength={300}
                defaultValue={values?.address ?? project.address ?? ""}
                className="form-input"
                placeholder="Dirección que aparece como Dirección de Envío"
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
          <DialogFooter>
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
          </DialogFooter>
      </form>
    </Dialog>
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
      {open && (
        <EditProjectForm
          key={`${project.id}-${project.name}-${project.code}-${project.status}`}
          companyId={companyId}
          project={project}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
