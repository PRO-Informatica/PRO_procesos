"use client";

import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";

import { registerIncidentAction } from "../actions";
import { initialIncidentMutationState, type IncidentTypeOption } from "../types";
import { DocumentUploader } from "./document-uploader";

export function RegisterIncidentDialog({ projectId, dispatchId, types, onClose }: { projectId: string; dispatchId: string; types: IncidentTypeOption[]; onClose: () => void }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [state, action, pending] = useActionState(registerIncidentAction, initialIncidentMutationState);
  useGlobalPending(pending, "Registrando incidencia…", "Guardando la incidencia sin alterar el resultado del despacho.");
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  return <motion.div className="fixed inset-0 z-[85] grid place-items-center overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }}>
    <motion.div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" initial={reduceMotion ? false : { y: 10 }} animate={{ y: 0 }}>
      <div className="flex items-start justify-between border-b border-border px-5 py-4 sm:px-6"><div className="flex gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-strong"><AlertTriangle className="size-5" /></span><div><h2 className="font-semibold text-foreground">Registrar incidencia</h2><p className="mt-1 text-xs text-foreground-muted">No modifica el resultado ni las cantidades físicas.</p></div></div><button type="button" onClick={onClose} disabled={pending} className="grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label="Cerrar"><X className="size-5" /></button></div>
      {state.status === "success" && state.incidentId ? <div className="p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" /><div><h3 className="font-semibold text-foreground">Incidencia registrada</h3><p className="mt-1 text-sm text-foreground-muted">La incidencia quedó vinculada al despacho. Puedes adjuntar evidencia sin mezclarla con el documento principal de la guía.</p></div></div><div className="mt-5 rounded-xl border border-border bg-muted/20 p-4"><h4 className="text-sm font-semibold text-foreground">Evidencia de incidencia</h4><p className="mt-1 text-xs text-foreground-muted">Foto o PDF opcional.</p><div className="mt-3"><DocumentUploader projectId={projectId} contextId={state.incidentId} context="incident" label="Subir evidencia" /></div></div><div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="primary-button">Volver al despacho</button></div></div> : <form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="dispatchId" value={dispatchId} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"><div className="sm:col-span-2"><label className="form-label" htmlFor="incident-type">Tipo *</label><select id="incident-type" name="incidentTypeId" required className="form-input"><option value="">Selecciona un tipo activo</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div><div><label className="form-label" htmlFor="incident-responsibility">Responsabilidad *</label><select id="incident-responsibility" name="responsibility" required className="form-input"><option value="SUPPLIER">Proveedor</option><option value="PROJECT">Proyecto</option><option value="SHARED">Compartida</option><option value="UNDETERMINED">Por determinar</option></select></div><div><label className="form-label" htmlFor="incident-charge">Aplica cobro *</label><select id="incident-charge" name="chargeApplicability" required className="form-input"><option value="YES">Sí</option><option value="NO">No</option><option value="UNDETERMINED">Por determinar</option></select></div><div className="sm:col-span-2"><label className="form-label" htmlFor="incident-notes">Notas</label><textarea id="incident-notes" name="notes" rows={4} maxLength={1000} className="form-input resize-y" /></div>{state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive sm:col-span-2">{state.message}</p>}</div>
        <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Cancelar</button><LoadingButton loadingLabel="Registrando…" disabled={!types.length}>Registrar incidencia</LoadingButton></div>
      </form>}
    </motion.div>
  </motion.div>;
}
