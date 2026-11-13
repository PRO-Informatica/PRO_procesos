"use client";

import { CalendarClock, Droplets, GripVertical, Truck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState, useTransition, type DragEvent } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { motionTokens } from "@/lib/motion/tokens";

import {
  formatProgrammingDate,
  formatProgrammingQuantity,
  formatProgrammingStatus,
  formatProgrammingTime,
  programmingStatusTone,
} from "../formatters";
import {
  type ProgrammingEffectiveStatus,
  type ProgrammingItem,
} from "../types";
import { getProgrammingDisplayStatus, getProgrammingVisibleStatuses } from "../status-presentation";
import { moveProgrammingKanbanAction } from "../kanban-actions";
import { getKanbanMoveTargets, isKanbanMoveTarget, type KanbanMoveTarget } from "../kanban-policy";
import { ProgrammingCancelDialog } from "./programming-cancel-dialog";

function ProgrammingCard({
  item,
  timezone,
  onSelect,
  residentView,
  targets = [],
  onMove,
  onDragStart,
  onDragEnd,
  dragging = false,
}: {
  item: ProgrammingItem;
  timezone: string;
  onSelect: (item: ProgrammingItem) => void;
  residentView: boolean;
  targets?: KanbanMoveTarget[];
  onMove: (target: KanbanMoveTarget) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  dragging?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div draggable={targets.length > 0} onDragStart={targets.length ? onDragStart : undefined} onDragEnd={onDragEnd}
      className={dragging ? "opacity-35" : undefined}>
    <motion.button
      type="button"
      draggable={targets.length > 0}
      onClick={() => onSelect(item)}
      className={`data-card-interactive w-full touch-manipulation rounded-xl border border-border bg-surface p-3.5 text-left shadow-sm active:border-brand/30 active:bg-brand-soft/10 ${targets.length ? "cursor-grab select-none active:cursor-grabbing" : ""}`}
      whileTap={reduceMotion ? undefined : { scale: 0.995 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.hover, ease: motionTokens.ease }}
    >
      <div className="flex items-start justify-between gap-3">
        {targets.length > 0 && <GripVertical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground-muted" />}
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-foreground-muted">
            PRG-{item.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-foreground" title={item.supplierName}>
            {item.supplierName}
          </p>
        </div>
        {item.requiresPumping && (
          <span title="Requiere bombeo" className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <Droplets aria-hidden="true" className="size-3.5" />
          </span>
        )}
      </div>
      <div className="mt-3.5 flex items-center gap-2 text-xs leading-5 text-foreground-muted">
        <CalendarClock aria-hidden="true" className="size-3.5 text-brand-strong" />
        <span>{formatProgrammingDate(item.scheduledAt, timezone)}</span>
        <strong className="ml-auto text-foreground">{formatProgrammingTime(item.scheduledAt, timezone)}</strong>
      </div>
      <p className="mt-2.5 text-base font-semibold tracking-tight text-foreground">
        {formatProgrammingQuantity(item.requestedQuantity)} {item.unitCode}
      </p>
      {item.placementGroup && (
        <p className="mt-1 truncate text-xs text-foreground-muted" title={item.placementGroup}>
          {item.placementGroup}
        </p>
      )}
      <div className="mt-3.5 flex items-end justify-between gap-2 border-t border-border pt-3">
        <span className={`inline-flex w-fit max-w-[10.5rem] rounded-full px-2.5 py-1 text-[10px] font-semibold leading-3.5 [overflow-wrap:anywhere] ${programmingStatusTone(item.effectiveStatus, residentView)}`}>
          {formatProgrammingStatus(item.effectiveStatus, residentView)}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-muted">
          <Truck aria-hidden="true" className="size-3.5" />
          {item.dispatches.length}
        </span>
      </div>
    </motion.button>
    {targets.length > 0 && (
      <div className="mt-2 flex items-center gap-2 px-1 lg:sr-only lg:focus-within:not-sr-only">
        <select
          aria-label={`Mover programación PRG-${item.id.slice(0, 8).toUpperCase()}`}
          value=""
          onChange={(event) => {
            const target = event.target.value as ProgrammingEffectiveStatus;
            if (isKanbanMoveTarget(target) && targets.includes(target)) onMove(target);
          }}
          className="form-input min-w-0 flex-1 py-1.5 text-xs"
        >
          <option value="" disabled>Mover a…</option>
          {targets.map((target) => <option key={target} value={target}>{formatProgrammingStatus(target, residentView)}</option>)}
        </select>
      </div>
    )}
    </div>
  );
}

export function ProgrammingKanban({
  items,
  timezone,
  onSelect,
  residentView = false,
  canStart = false,
  canCancel = false,
  onUpdated,
}: {
  items: ProgrammingItem[];
  timezone: string;
  onSelect: (item: ProgrammingItem) => void;
  residentView?: boolean;
  canStart?: boolean;
  canCancel?: boolean;
  onUpdated?: () => void;
}) {
  const [mobileStatus, setMobileStatus] = useState<ProgrammingEffectiveStatus>("CONFIRMED");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const [cancelItem, setCancelItem] = useState<ProgrammingItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [placement, setPlacement] = useState<{ id: string; target: KanbanMoveTarget; source: ProgrammingItem } | null>(null);
  const targetsFor = (item: ProgrammingItem) => residentView && !pending && !cancelItem
    ? getKanbanMoveTargets(item, { canStart, canCancel }) : [];
  const stopDragging = () => { dragging.current = null; setDraggingId(null); };
  const move = (item: ProgrammingItem, target: KanbanMoveTarget) => {
    if (!targetsFor(item).includes(target)) return;
    setError(null); setMessage(null);
    setPlacement({ id: item.id, target, source: item });
    if (target === "CANCELLED") { setCancelItem(item); return; }
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("projectId", item.projectId); form.set("programmingId", item.id);
        form.set("expectedVersion", String(item.version)); form.set("intent", "start");
        const result = await moveProgrammingKanbanAction({ status: "idle" }, form);
        if (result.status !== "success") {
          setPlacement(null);
          setError(result.message ?? "No fue posible mover la programación.");
          if (result.conflict) onUpdated?.();
          return;
        }
        setMessage("Programación en ejecución. Despacho iniciado.");
        onUpdated?.();
      } catch {
        setPlacement(null);
        setError("No fue posible mover la programación. Actualiza el tablero antes de reintentar.");
      }
    });
  };
  const card = (item: ProgrammingItem) => (
    <ProgrammingCard key={item.id} item={item} timezone={timezone} onSelect={(selected) => { if (!dragging.current) onSelect(selected); }} residentView={residentView}
      targets={targetsFor(item)} onMove={(target) => move(item, target)} onDragEnd={stopDragging} dragging={draggingId === item.id}
      onDragStart={(event) => {
        if (!targetsFor(item).length) { event.preventDefault(); return; }
        dragging.current = item.id; setDraggingId(item.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-pro-programming", item.id);
        if (event.dataTransfer.setDragImage) {
          const preview = event.currentTarget.querySelector("button") ?? event.currentTarget;
          const bounds = preview.getBoundingClientRect();
          event.dataTransfer.setDragImage(preview, event.clientX - bounds.left, event.clientY - bounds.top);
        }
      }} />
  );
  const canDrop = (status: ProgrammingEffectiveStatus, itemId = draggingId) => {
    const item = items.find((candidate) => candidate.id === itemId);
    return Boolean(item && isKanbanMoveTarget(status) && targetsFor(item).includes(status));
  };
  const visibleStatuses = getProgrammingVisibleStatuses(residentView);
  const visibleMobileStatus = getProgrammingDisplayStatus(mobileStatus, residentView);
  const grouped = Object.fromEntries(
    visibleStatuses.map((status) => [
      status,
      items.map((item) => placement?.id === item.id && placement.source === item
        ? { ...item, status: placement.target, effectiveStatus: placement.target } : item)
        .filter((item) => getProgrammingDisplayStatus(item.effectiveStatus, residentView) === status),
    ]),
  ) as Record<ProgrammingEffectiveStatus, ProgrammingItem[]>;

  return (
    <>
      {residentView && (canStart || canCancel) && <p className="mb-3 text-xs text-foreground-muted">Arrastra la tarjeta confirmada y suéltala en En ejecución o Cancelado. Las tarjetas en ejecución no se pueden mover.</p>}
      <p role="status" aria-live="polite" className={pending ? "mb-3 text-xs font-medium text-foreground-muted" : "sr-only"}>{pending ? "Iniciando despacho…" : message}</p>
      {error && <p role="alert" className="mb-3 rounded-lg bg-destructive-soft p-3 text-sm text-destructive">{error}</p>}
      <div className="lg:hidden">
        <label htmlFor="kanban-mobile-status" className="form-label">
          Estado visible
        </label>
        <select
          id="kanban-mobile-status"
          value={visibleMobileStatus}
          onChange={(event) => setMobileStatus(event.target.value as ProgrammingEffectiveStatus)}
          className="form-input"
        >
          {visibleStatuses.map((status) => (
            <option key={status} value={status}>
              {formatProgrammingStatus(status, residentView)} ({grouped[status].length})
            </option>
          ))}
        </select>
        <div
          className={`subtle-scrollbar mt-4 space-y-3 ${
            grouped[visibleMobileStatus].length > 3
              ? "max-h-[36rem] overflow-y-auto overflow-x-hidden pr-1"
              : ""
          }`}
        >
          {grouped[visibleMobileStatus].length ? (
            grouped[visibleMobileStatus].map(card)
          ) : (
            <EmptyState
              title={`Sin elementos en ${formatProgrammingStatus(visibleMobileStatus, residentView).toLowerCase()}`}
              description="No hay programaciones con este estado dentro del rango y filtros actuales."
            />
          )}
        </div>
      </div>

      <div className="subtle-scrollbar hidden overflow-x-auto pb-3 lg:block">
        <div className={`grid gap-3 ${residentView ? "min-w-[1100px] grid-cols-5" : "min-w-[1320px] grid-cols-6"}`}>
          {visibleStatuses.map((status) => (
            <section key={status}
              aria-label={formatProgrammingStatus(status, residentView)}
              onDragOver={(event) => {
                if (canDrop(status, dragging.current)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
              }}
              onDrop={(event) => {
                const item = items.find((candidate) => candidate.id === dragging.current);
                if (!item || event.dataTransfer.getData("application/x-pro-programming") !== item.id || !isKanbanMoveTarget(status) || !canDrop(status, item.id)) return;
                event.preventDefault(); stopDragging(); move(item, status);
              }}
              className={`min-w-0 rounded-xl border bg-muted/30 p-3 transition-colors ${canDrop(status) ? "border-brand bg-brand-soft/30 ring-2 ring-brand/20" : "border-border"}`}>
              <div className="flex items-center justify-between gap-2 px-1 pb-3">
                <h2 className="text-xs font-semibold text-foreground">
                  {formatProgrammingStatus(status, residentView)}
                </h2>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
                  {grouped[status].length}
                </span>
              </div>
              <div
                className={`subtle-scrollbar space-y-3 ${
                  grouped[status].length > 3
                    ? "max-h-[34rem] overflow-y-auto overflow-x-hidden overscroll-contain pr-1"
                    : ""
                }`}
              >
                {canDrop(status) && <div className="rounded-lg border-2 border-dashed border-brand bg-brand-soft/40 p-4 text-center text-xs font-semibold text-brand-strong">Suelta la tarjeta aquí</div>}
                {grouped[status].map(card)}
                {!grouped[status].length && !canDrop(status) && (
                  <div className="rounded-lg border border-dashed border-border bg-surface/60 px-3 py-8 text-center text-xs text-foreground-muted">
                    Sin programaciones
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      {cancelItem && <ProgrammingCancelDialog item={cancelItem} mutationAction={moveProgrammingKanbanAction}
        onClose={() => { setCancelItem(null); setPlacement(null); }} onCancelled={() => { setCancelItem(null); setMessage("Programación cancelada."); onUpdated?.(); }} />}
    </>
  );
}
