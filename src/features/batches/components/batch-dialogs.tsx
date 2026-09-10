"use client";

import { AlertTriangle, CalendarRange, CheckCircle2, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

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

export function AddDispatchDialog({ projectId, batchId, dispatches, onClose, onSuccess }: { projectId: string; batchId: string; dispatches: EligibleBatchDispatch[]; onClose: () => void; onSuccess?: () => void | Promise<void> }) {
  const router = useRouter();
  const successHandled = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [state, action, pending] = useActionState(addDispatchToBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.dispatchAdded });
  useEffect(() => {
    if (state.status === "success" && !successHandled.current) {
      successHandled.current = true;
      void (async () => {
        try { if (onSuccess) await onSuccess(); else router.refresh(); }
        finally { onClose(); }
      })();
    }
  }, [onClose, onSuccess, router, state.status]);

  const allSelected = dispatches.length > 0 && selectedIds.length === dispatches.length;
  function toggle(dispatchId: string) {
    setSelectedIds((current) => current.includes(dispatchId) ? current.filter((id) => id !== dispatchId) : [...current, dispatchId]);
  }

  return (
    <Modal title="Agregar despachos" description="Selecciona uno o varios despachos disponibles para agregarlos al lote en una sola operación." icon={Plus} onClose={onClose} pending={pending}>
      <form action={action}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="batchId" value={batchId} />
        <div className="p-4 sm:p-6">
          <div className="flex min-h-11 flex-col items-stretch gap-2 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
            <div>
              <p className="form-label mb-0">Despachos disponibles *</p>
              <p className="mt-1 text-xs text-foreground-muted" aria-live="polite">{selectedIds.length} de {dispatches.length} seleccionados</p>
            </div>
            {dispatches.length > 0 && (
              <button type="button" onClick={() => setSelectedIds(allSelected ? [] : dispatches.map((item) => item.dispatchId))} disabled={pending} className="min-h-11 self-start rounded-lg border border-brand/25 px-3 text-xs font-semibold text-brand-strong transition-colors hover:bg-brand-soft active:bg-brand-soft disabled:opacity-50 min-[420px]:self-auto">
                {allSelected ? "Quitar selección" : "Seleccionar todos"}
              </button>
            )}
          </div>

          {dispatches.length ? (
            <div className={`mt-3 space-y-2 ${dispatches.length > 3 ? "max-h-[13rem] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]" : ""}`}>
              {dispatches.map((item) => {
                const selected = selectedIds.includes(item.dispatchId);
                return (
                  <label key={item.dispatchId} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors active:bg-brand-soft/50 ${selected ? "border-brand bg-brand-soft/35" : "border-border bg-surface hover:border-brand/35 hover:bg-muted/35"}`}>
                    <input type="checkbox" name="dispatchIds" value={item.dispatchId} checked={selected} onChange={() => toggle(item.dispatchId)} disabled={pending} className="mt-1 size-5 shrink-0 accent-[var(--brand)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <strong className="text-sm text-foreground">{item.programmingCode}</strong>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">{item.operationalStatus === "COMPLETED" ? "Completado" : "En ejecución"}</span>
                      </span>
                      <span className="mt-1 block break-words text-xs text-foreground-muted">Pedido {item.orderNumber ?? "pendiente"} · {item.supplierName}{item.realVolume === null ? "" : ` · ${formatBatchQuantity(item.realVolume)} ${item.realUnitCode ?? ""}`}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-foreground-muted">No hay despachos elegibles para agregar.</div>
          )}
          <Message state={state} />
        </div>
        <Footer onClose={onClose} pending={pending} disabled={!selectedIds.length} label={selectedIds.length === 1 ? "Agregar 1 despacho" : `Agregar ${selectedIds.length} despachos`} loading="Agregando…" />
      </form>
    </Modal>
  );
}

export function RemoveDispatchDialog({ projectId, batchId, relation, onClose, onSuccess }: { projectId: string; batchId: string; relation: BatchDispatchRelation; onClose: () => void; onSuccess?: () => void | Promise<void> }) {
  const router = useRouter(); const successHandled = useRef(false); const [state, action, pending] = useActionState(removeDispatchFromBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.dispatchRemoved });
  useEffect(() => { if (state.status === "success" && !successHandled.current) { successHandled.current = true; void (async () => { try { if (onSuccess) await onSuccess(); else router.refresh(); } finally { onClose(); } })(); } }, [onClose, onSuccess, router, state.status]);
  return <Modal title="Remover despacho" description={`${relation.programmingCode} se retirará del lote sin borrar su historial.`} icon={AlertTriangle} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><input type="hidden" name="dispatchId" value={relation.dispatchId} /><div className="p-5 sm:p-6"><label className="form-label" htmlFor="remove-reason">Motivo *</label><textarea id="remove-reason" name="reason" required maxLength={1000} rows={4} className="form-input resize-y" /><Message state={state} /></div><Footer onClose={onClose} pending={pending} label="Remover despacho" loading="Removiendo…" /></form></Modal>;
}

export function RolloverDialog({ projectId, batchId, preview, onClose, onSuccess }: { projectId: string; batchId: string; preview: BatchRolloverPreview[]; onClose: () => void; onSuccess?: () => void | Promise<void> }) {
  const router = useRouter(); const successHandled = useRef(false); const [state, action, pending] = useActionState(rolloverBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.batchClosed });
  useEffect(() => { if (state.status === "success" && !successHandled.current) { successHandled.current = true; void (async () => { try { if (onSuccess) await onSuccess(); else router.refresh(); } finally { onClose(); } })(); } }, [onClose, onSuccess, router, state.status]);
  const stay = preview.filter((row) => row.action === "STAY"), move = preview.filter((row) => row.action === "MOVE"), next = preview[0];
  return <Modal title="Cerrar semana y preparar siguiente" description="Los conciliados permanecen; cualquier proceso pendiente continúa en la siguiente semana." icon={RotateCcw} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><div className="space-y-4 p-5 sm:p-6">{next && <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm"><p className="font-semibold">Siguiente semana</p><p className="mt-1 text-foreground-muted">{formatBatchDate(next.destinationPeriodStart)} – {formatBatchDate(next.destinationPeriodEnd)}</p></div>}<div className="grid gap-3 sm:grid-cols-2"><Summary label="Permanecen conciliados" value={stay.length} tone="success" /><Summary label="Continúan siguiente semana" value={move.length} tone="warning" /></div><Message state={state} /></div><Footer onClose={onClose} pending={pending} label="Confirmar cierre" loading="Cerrando…" icon /></form></Modal>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" }) { return <div className={`rounded-xl border p-4 ${tone === "success" ? "border-success/20 bg-success-soft text-success" : "border-amber-300/30 bg-amber-50 text-amber-900 dark:bg-amber-950/35 dark:text-amber-200"}`}><p className="text-xs font-semibold uppercase">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function Message({ state }: { state: BatchMutationState }) { return state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-sm ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p> : null; }
function Footer({ onClose, pending, disabled, label, loading, icon }: { onClose: () => void; pending: boolean; disabled?: boolean; label: string; loading: string; icon?: boolean }) { return <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button><LoadingButton disabled={disabled} loadingLabel={loading}>{icon && <CheckCircle2 className="size-4" />}{label}</LoadingButton></DialogFooter>; }
