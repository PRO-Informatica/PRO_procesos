"use client";

import { AlertTriangle, CalendarRange, CheckCircle2, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import type { ProjectSummary } from "@/features/projects/types";
import { notifications } from "@/lib/notification-messages";

import { addDispatchToBatchAction, createBatchAction, removeDispatchFromBatchAction, rolloverBatchAction } from "../actions";
import { formatBatchDate, formatBatchQuantity } from "../formatters";
import { initialBatchMutationState, type BatchDispatchRelation, type BatchMutationState, type BatchRolloverPreview, type EligibleBatchDispatch } from "../types";

export function Modal({ title, description, icon: Icon, onClose, pending, children, wide = false }: { title: string; description: string; icon: typeof Plus; onClose: () => void; pending: boolean; children: React.ReactNode; wide?: boolean }) {
  return <Dialog title={title} description={description} icon={Icon} onClose={onClose} pending={pending} size={wide ? "xl" : "md"}>{children}</Dialog>;
}

function localDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((row) => row.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function weekFor(value: string) {
  const date = new Date(`${value}T12:00:00Z`), day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1); const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6); return { start, end: date.toISOString().slice(0, 10) };
}

export function CreateBatchDialog({ project, onClose }: { project: ProjectSummary; onClose: () => void }) {
  const router = useRouter(), week = weekFor(localDate(project.timezone));
  const [state, action, pending] = useActionState(createBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.batchCreated });
  useEffect(() => { if (state.status === "success" && state.batchId) router.push(`/batches/${state.batchId}`); }, [router, state]);
  return <Modal title="Crear lote semanal" description="La semana canónica inicia lunes y termina domingo." icon={CalendarRange} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={project.id} /><div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"><div className="sm:col-span-2"><label className="form-label" htmlFor="batch-code">Código *</label><input id="batch-code" name="code" required maxLength={80} defaultValue={`LOT-${week.start}`} className="form-input" /></div><div><label className="form-label" htmlFor="batch-start">Lunes *</label><input id="batch-start" name="periodStart" type="date" required defaultValue={week.start} className="form-input" /></div><div><label className="form-label" htmlFor="batch-end">Domingo *</label><input id="batch-end" name="periodEnd" type="date" required defaultValue={week.end} className="form-input" /></div><Message state={state} /></div><Footer onClose={onClose} pending={pending} label="Crear lote semanal" loading="Creando…" /></form></Modal>;
}

export function AddDispatchDialog({ projectId, batchId, dispatches, onClose }: { projectId: string; batchId: string; dispatches: EligibleBatchDispatch[]; onClose: () => void }) {
  const router = useRouter(); const [state, action, pending] = useActionState(addDispatchToBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.dispatchAdded });
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <Modal title="Agregar despacho" description="Despachos en ejecución o completados disponibles en el proyecto." icon={Plus} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><div className="p-5 sm:p-6"><label className="form-label" htmlFor="eligible-dispatch">Despacho *</label><select id="eligible-dispatch" name="dispatchId" required className="form-input" disabled={!dispatches.length}><option value="">{dispatches.length ? "Selecciona un despacho" : "No hay despachos elegibles"}</option>{dispatches.map((item) => <option key={item.dispatchId} value={item.dispatchId}>{item.programmingCode} · Pedido {item.orderNumber ?? "pendiente"} · {item.supplierName} · {item.operationalStatus === "COMPLETED" ? "Completado" : "En ejecución"}{item.realVolume === null ? "" : ` · ${formatBatchQuantity(item.realVolume)} ${item.realUnitCode}`}</option>)}</select><Message state={state} /></div><Footer onClose={onClose} pending={pending} disabled={!dispatches.length} label="Agregar despacho" loading="Agregando…" /></form></Modal>;
}

export function RemoveDispatchDialog({ projectId, batchId, relation, onClose }: { projectId: string; batchId: string; relation: BatchDispatchRelation; onClose: () => void }) {
  const router = useRouter(); const [state, action, pending] = useActionState(removeDispatchFromBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.dispatchRemoved });
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <Modal title="Remover despacho" description={`${relation.programmingCode} se retirará del lote sin borrar su historial.`} icon={AlertTriangle} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><input type="hidden" name="dispatchId" value={relation.dispatchId} /><div className="p-5 sm:p-6"><label className="form-label" htmlFor="remove-reason">Motivo *</label><textarea id="remove-reason" name="reason" required maxLength={1000} rows={4} className="form-input resize-y" /><Message state={state} /></div><Footer onClose={onClose} pending={pending} label="Remover despacho" loading="Removiendo…" /></form></Modal>;
}

export function RolloverDialog({ projectId, batchId, preview, onClose }: { projectId: string; batchId: string; preview: BatchRolloverPreview[]; onClose: () => void }) {
  const router = useRouter(); const [state, action, pending] = useActionState(rolloverBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.batchClosed });
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  const stay = preview.filter((row) => row.action === "STAY"), move = preview.filter((row) => row.action === "MOVE"), next = preview[0];
  return <Modal title="Cerrar semana y preparar siguiente" description="Los conciliados permanecen; cualquier proceso pendiente continúa en la siguiente semana." icon={RotateCcw} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><div className="space-y-4 p-5 sm:p-6">{next && <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm"><p className="font-semibold">Siguiente semana</p><p className="mt-1 text-foreground-muted">{formatBatchDate(next.destinationPeriodStart)} – {formatBatchDate(next.destinationPeriodEnd)}</p></div>}<div className="grid gap-3 sm:grid-cols-2"><Summary label="Permanecen conciliados" value={stay.length} tone="success" /><Summary label="Continúan siguiente semana" value={move.length} tone="warning" /></div><Message state={state} /></div><Footer onClose={onClose} pending={pending} label="Confirmar cierre" loading="Cerrando…" icon /></form></Modal>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" }) { return <div className={`rounded-xl border p-4 ${tone === "success" ? "border-success/20 bg-success-soft text-success" : "border-amber-300/30 bg-amber-50 text-amber-900 dark:bg-amber-950/35 dark:text-amber-200"}`}><p className="text-xs font-semibold uppercase">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function Message({ state }: { state: BatchMutationState }) { return state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-sm ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p> : null; }
function Footer({ onClose, pending, disabled, label, loading, icon }: { onClose: () => void; pending: boolean; disabled?: boolean; label: string; loading: string; icon?: boolean }) { return <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button><LoadingButton disabled={disabled} loadingLabel={loading}>{icon && <CheckCircle2 className="size-4" />}{label}</LoadingButton></DialogFooter>; }
