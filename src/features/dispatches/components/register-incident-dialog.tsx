"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { registerIncidentAction } from "../actions";
import { initialIncidentMutationState, type IncidentTypeOption } from "../types";
import { DocumentUploader } from "./document-uploader";

export function RegisterIncidentDialog({ projectId, dispatchId, types, onClose }: { projectId: string; dispatchId: string; types: IncidentTypeOption[]; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(registerIncidentAction, initialIncidentMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.incidentCreated, error: notifications.saveFailed });
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  return <Dialog title="Registrar incidencia" description="No modifica el resultado ni las cantidades físicas." icon={AlertTriangle} onClose={onClose} pending={pending}>
      {state.status === "success" && state.incidentId ? <div className="p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" /><div><h3 className="font-semibold text-foreground">Incidencia registrada</h3><p className="mt-1 text-sm text-foreground-muted">La incidencia quedó vinculada al despacho. Puedes adjuntar evidencia sin mezclarla con el documento principal de la guía.</p></div></div><div className="mt-5 rounded-xl border border-border bg-muted/20 p-4"><h4 className="text-sm font-semibold text-foreground">Evidencia de incidencia</h4><p className="mt-1 text-xs text-foreground-muted">Foto o PDF opcional.</p><div className="mt-3"><DocumentUploader projectId={projectId} contextId={state.incidentId} context="incident" label="Subir evidencia" /></div></div><div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="primary-button">Volver al despacho</button></div></div> : <form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="dispatchId" value={dispatchId} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"><div className="sm:col-span-2"><label className="form-label" htmlFor="incident-type">Tipo *</label><select id="incident-type" name="incidentTypeId" required className="form-input"><option value="">Selecciona un tipo activo</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div><div><label className="form-label" htmlFor="incident-responsibility">Responsabilidad *</label><select id="incident-responsibility" name="responsibility" required className="form-input"><option value="SUPPLIER">Proveedor</option><option value="PROJECT">Proyecto</option><option value="SHARED">Compartida</option><option value="UNDETERMINED">Por determinar</option></select></div><div><label className="form-label" htmlFor="incident-charge">Aplica cobro *</label><select id="incident-charge" name="chargeApplicability" required className="form-input"><option value="YES">Sí</option><option value="NO">No</option><option value="UNDETERMINED">Por determinar</option></select></div><div className="sm:col-span-2"><label className="form-label" htmlFor="incident-notes">Notas</label><textarea id="incident-notes" name="notes" rows={4} maxLength={1000} className="form-input resize-y" /></div>{state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive sm:col-span-2">{state.message}</p>}</div>
        <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button><LoadingButton loadingLabel="Registrando…" disabled={!types.length}>Registrar incidencia</LoadingButton></DialogFooter>
      </form>}
  </Dialog>;
}
