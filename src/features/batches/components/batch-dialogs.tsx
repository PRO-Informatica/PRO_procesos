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
import { projectCalendarDate, weeklyBatchPeriods, type BatchPeriod } from "../period-policy";
import { initialBatchMutationState, type BatchDispatchRelation, type BatchMutationState, type BatchRolloverPreview, type EligibleBatchDispatch } from "../types";

export function Modal({ title, description, icon: Icon, onClose, pending, children, wide = false }: { title: string; description: string; icon: typeof Plus; onClose: () => void; pending: boolean; children: React.ReactNode; wide?: boolean }) {
  return <Dialog title={title} description={description} icon={Icon} onClose={onClose} pending={pending} size={wide ? "xl" : "md"}>{children}</Dialog>;
}

export function CreateBatchDialog({ project, onClose }: { project: ProjectSummary; onClose: () => void }) {
  const router = useRouter();
  const [reference, setReference] = useState(() => projectCalendarDate(project.timezone));
  let periods: BatchPeriod[] = [];
  try { if (reference) periods = weeklyBatchPeriods(reference); } catch { /* Incomplete date input. */ }
  const split = periods.length === 2;
  const [state, action, pending] = useActionState(createBatchAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.batchCreated });
  useEffect(() => { if (state.status === "success" && state.batchId) router.push(`/batches/${state.batchId}`); }, [router, state]);
  return <Modal title="Crear lote semanal" description="Cada lote pertenece a un solo mes, aunque la semana cruce de mes." icon={CalendarRange} onClose={onClose} pending={pending}>
    <form action={action}>
      <input type="hidden" name="projectId" value={project.id} />
      <div className="space-y-4 p-5 sm:p-6">
        <div><label className="form-label" htmlFor="batch-reference">Fecha de la semana *</label><input id="batch-reference" name="referenceDate" type="date" required value={reference} onChange={(event) => setReference(event.target.value)} disabled={pending} className="form-input" /></div>
        <div><label className="form-label" htmlFor="batch-code">{split ? "Código base *" : "Código *"}</label><input key={periods[0]?.start} id="batch-code" name="code" required maxLength={70} defaultValue={`LOT-${periods[0]?.start ?? ""}`} className="form-input" /></div>
        <div className="space-y-2 rounded-xl border border-border bg-muted/25 p-4 text-sm">
          {periods.map((period) => <p key={period.start}>{formatBatchDate(period.start)} – {formatBatchDate(period.end)} · Mes {period.accountingPeriod.slice(0, 7)}</p>)}
        </div>
        {split && <div role="alert" className="rounded-xl border border-brand/25 bg-brand-soft p-4 text-sm text-foreground">
          <p className="font-semibold text-brand-strong">Se crearán dos lotes</p><p className="mt-1">Esta semana cruza de mes. Los últimos días del mes y los primeros del siguiente tendrán lotes separados. Se añadirá el mes a cada código.</p>
          <label key={periods[0]?.start} className="mt-3 flex items-start gap-2"><input type="checkbox" name="confirmSplit" value="yes" required className="mt-1 accent-[var(--brand)]" />Confirmo la creación de los dos lotes.</label>
        </div>}
        <p className="text-xs text-foreground-muted">El cierre es manual. Si hay un lote abierto de una semana cuyo domingo ya pasó, debes cerrarlo antes de crear otro.</p>
        <Message state={state} />
      </div>
      <Footer onClose={onClose} pending={pending} disabled={!periods.length} label={split ? "Crear dos lotes" : "Crear lote semanal"} loading="Creando…" />
    </form>
  </Modal>;
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
  return <Modal title="Cerrar lote y preparar siguiente" description="Permanecen los despachos con producto conciliado y facturas requeridas completas. Los pendientes pasan al siguiente período, separado por mes." icon={RotateCcw} onClose={onClose} pending={pending}><form action={action}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><div className="space-y-4 p-5 sm:p-6">{next && <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm"><p className="font-semibold">Siguiente período</p><p className="mt-1 text-foreground-muted">{formatBatchDate(next.destinationPeriodStart)} – {formatBatchDate(next.destinationPeriodEnd)}</p></div>}<div className="grid gap-3 sm:grid-cols-2"><Summary label="Permanecen completos" value={stay.length} tone="success" /><Summary label="Continúan siguiente período" value={move.length} tone="warning" /></div><Message state={state} /></div><Footer onClose={onClose} pending={pending} label="Confirmar cierre" loading="Cerrando…" icon /></form></Modal>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" }) { return <div className={`rounded-xl border p-4 ${tone === "success" ? "border-success/20 bg-success-soft text-success" : "border-amber-300/30 bg-amber-50 text-amber-900 dark:bg-amber-950/35 dark:text-amber-200"}`}><p className="text-xs font-semibold uppercase">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function Message({ state }: { state: BatchMutationState }) { return state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-sm ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p> : null; }
function Footer({ onClose, pending, disabled, label, loading, icon }: { onClose: () => void; pending: boolean; disabled?: boolean; label: string; loading: string; icon?: boolean }) { return <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button><LoadingButton disabled={disabled} loadingLabel={loading}>{icon && <CheckCircle2 className="size-4" />}{label}</LoadingButton></DialogFooter>; }
