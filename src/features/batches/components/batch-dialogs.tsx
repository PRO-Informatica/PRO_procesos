"use client";

import { AlertTriangle, CalendarRange, CheckCircle2, Plus, RotateCcw, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { LoadingButton } from "@/components/feedback/loading-button";
import type { ProjectSummary } from "@/features/projects/types";

import {
  addGuideToBatchAction,
  createBatchAction,
  removeGuideFromBatchAction,
  rolloverBatchAction,
} from "../actions";
import { formatBatchDate, formatBatchQuantity } from "../formatters";
import {
  initialBatchMutationState,
  type BatchGuideRelation,
  type BatchRolloverPreview,
  type EligibleBatchGuide,
} from "../types";

export function Modal({
  title,
  description,
  icon: Icon,
  onClose,
  pending,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Plus;
  onClose: () => void;
  pending: boolean;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-[85] grid place-items-center overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        initial={reduceMotion ? false : { y: 10 }}
        animate={{ y: 0 }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              <Icon aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">{title}</h2>
              <p className="mt-1 text-xs text-foreground-muted">{description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={pending} className="grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label="Cerrar">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function localDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone,
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((row) => row.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function weekFor(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { start, end: date.toISOString().slice(0, 10) };
}

export function CreateBatchDialog({ project, onClose }: { project: ProjectSummary; onClose: () => void }) {
  const router = useRouter();
  const week = weekFor(localDate(project.timezone));
  const [state, action, pending] = useActionState(createBatchAction, initialBatchMutationState);
  useGlobalPending(pending, "Creando lote semanal…", "Validando la semana y el período contable.");
  useEffect(() => {
    if (state.status === "success" && state.batchId) router.push(`/batches/${state.batchId}`);
  }, [router, state.batchId, state.status]);
  return (
    <Modal title="Crear lote semanal" description="La semana canónica siempre inicia lunes y termina domingo." icon={CalendarRange} onClose={onClose} pending={pending}>
      <form action={action}>
        <input type="hidden" name="projectId" value={project.id} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="batch-code">Código *</label>
            <input id="batch-code" name="code" required maxLength={80} defaultValue={`LOT-${week.start}`} className="form-input" />
          </div>
          <div><label className="form-label" htmlFor="batch-start">Lunes *</label><input id="batch-start" name="periodStart" type="date" required defaultValue={week.start} className="form-input" /></div>
          <div><label className="form-label" htmlFor="batch-end">Domingo *</label><input id="batch-end" name="periodEnd" type="date" required defaultValue={week.end} className="form-input" /></div>
          {state.message && <p role={state.status === "error" ? "alert" : "status"} className={`rounded-lg px-4 py-3 text-sm sm:col-span-2 ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p>}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cancelar</button>
          <LoadingButton loadingLabel="Creando…">Crear lote semanal</LoadingButton>
        </div>
      </form>
    </Modal>
  );
}

export function AddGuideDialog({ projectId, batchId, guides, onClose }: { projectId: string; batchId: string; guides: EligibleBatchGuide[]; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addGuideToBatchAction, initialBatchMutationState);
  useGlobalPending(pending, "Agregando guía…", "Confirmando elegibilidad y actualizando el despacho.");
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return (
    <Modal title="Agregar guía" description="Solo aparecen despachos REGISTERED con fecha dentro de esta semana." icon={Plus} onClose={onClose} pending={pending}>
      <form action={action}>
        <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} />
        <div className="p-5 sm:p-6">
          <label className="form-label" htmlFor="eligible-guide">Guía elegible *</label>
          <select id="eligible-guide" name="guideId" required className="form-input" disabled={!guides.length}>
            <option value="">{guides.length ? "Selecciona una guía" : "No hay guías elegibles"}</option>
            {guides.map((guide) => <option key={guide.guideId} value={guide.guideId}>{guide.guideNumber} · {guide.supplierName} · {formatBatchQuantity(guide.receivedQuantity)} {guide.unitCode}</option>)}
          </select>
          {state.message && <p role={state.status === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-sm ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p>}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cancelar</button><LoadingButton disabled={!guides.length} loadingLabel="Agregando…">Agregar guía</LoadingButton></div>
      </form>
    </Modal>
  );
}

export function RemoveGuideDialog({ projectId, batchId, relation, onClose }: { projectId: string; batchId: string; relation: BatchGuideRelation; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(removeGuideFromBatchAction, initialBatchMutationState);
  useGlobalPending(pending, "Removiendo guía…", "Conservando el historial de la relación.");
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return (
    <Modal title="Remover guía" description={`${relation.guideNumber} volverá a REGISTERED si no conserva otra relación activa.`} icon={AlertTriangle} onClose={onClose} pending={pending}>
      <form action={action}>
        <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} /><input type="hidden" name="guideId" value={relation.guideId} />
        <div className="p-5 sm:p-6"><label className="form-label" htmlFor="remove-reason">Motivo obligatorio *</label><textarea id="remove-reason" name="reason" required maxLength={1000} rows={4} className="form-input resize-y" />{state.message && <p role={state.status === "error" ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-sm ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p>}</div>
        <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cancelar</button><LoadingButton loadingLabel="Removiendo…" className="primary-button bg-destructive hover:bg-destructive/90">Remover guía</LoadingButton></div>
      </form>
    </Modal>
  );
}

export function RolloverDialog({ projectId, batchId, preview, onClose }: { projectId: string; batchId: string; preview: BatchRolloverPreview[]; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(rolloverBatchAction, initialBatchMutationState);
  useGlobalPending(pending, "Preparando siguiente semana…", "Preservando historial y moviendo únicamente guías pendientes.");
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  const stay = preview.filter((row) => row.action === "STAY"), move = preview.filter((row) => row.action === "MOVE");
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of move) map.set(row.unitCode, (map.get(row.unitCode) ?? 0) + row.receivedQuantity);
    return [...map.entries()];
  }, [move]);
  const next = preview[0];
  return (
    <Modal title="Cerrar semana / Preparar siguiente" description="Los Pedidos completados permanecen en esta semana; los pendientes o en refacturación continúan en la siguiente." icon={RotateCcw} onClose={onClose} pending={pending}>
      <form action={action}>
        <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="batchId" value={batchId} />
        <div className="space-y-4 p-5 sm:p-6">
          {next && <div className="rounded-xl border border-border bg-muted/25 p-4 text-sm"><p className="font-semibold text-foreground">Siguiente semana</p><p className="mt-1 text-foreground-muted">{formatBatchDate(next.destinationPeriodStart)} – {formatBatchDate(next.destinationPeriodEnd)} · Período {formatBatchDate(next.destinationAccountingPeriod)}</p><p className="mt-1 text-xs text-foreground-muted">{next.destinationBatchId ? "Batch destino existente" : "Se creará automáticamente"}</p></div>}
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-success/20 bg-success-soft p-4"><p className="text-xs font-semibold uppercase text-success">Guías de pedidos completados</p><p className="mt-2 text-2xl font-semibold text-success">{stay.length}</p></div><div className="rounded-xl border border-amber-300/30 bg-amber-50 p-4 dark:bg-amber-950/35"><p className="text-xs font-semibold uppercase text-amber-800 dark:text-amber-300">Guías que continúan</p><p className="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-200">{move.length}</p></div></div>
          {totals.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Cantidades que continúan</p><div className="mt-2 flex flex-wrap gap-2">{totals.map(([unit, quantity]) => <span key={unit} className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">{formatBatchQuantity(quantity)} {unit}</span>)}</div></div>}
          {move.length > 0 && <div className="max-h-48 overflow-y-auto rounded-xl border border-border"><ul className="divide-y divide-border">{move.map((row) => <li key={row.batchGuideId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="font-semibold">{row.guideNumber}</span><span className="text-foreground-muted">{formatBatchQuantity(row.receivedQuantity)} {row.unitCode}</span></li>)}</ul></div>}
          {state.message && <p role={state.status === "error" ? "alert" : "status"} className={`rounded-lg px-4 py-3 text-sm ${state.status === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{state.message}</p>}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cancelar</button><LoadingButton loadingLabel="Preparando…"><CheckCircle2 aria-hidden="true" className="size-4" /> Confirmar rollover</LoadingButton></div>
      </form>
    </Modal>
  );
}
