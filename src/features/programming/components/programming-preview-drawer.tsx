"use client";

import { CalendarClock, CheckCircle2, ExternalLink, PackageOpen, Truck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { formatStatusLabel } from "@/lib/status-labels";

import { mutateProgrammingAction } from "../actions";

import {
  formatProgrammingDateTime,
  formatProgrammingQuantity,
  formatProgrammingStatus,
  programmingStatusTone,
} from "../formatters";
import { initialProgrammingMutationState, type ProgrammingItem } from "../types";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function ProgrammingPreviewDrawer({
  item,
  timezone,
  canConfirm,
  onUpdated,
  onClose,
}: {
  item: ProgrammingItem | null;
  timezone: string;
  canConfirm: boolean;
  onUpdated: (message: string) => void;
  onClose: () => void;
}) {
  const [availabilityNow] = useState(() => Date.now());
  const canDirectConfirm = Boolean(
    item && item.status === "PENDING_CONFIRMATION" &&
    new Date(item.scheduledAt).valueOf() >= availabilityNow,
  );
  const [state, confirmAction, pending] = useActionState(
    mutateProgrammingAction,
    initialProgrammingMutationState,
  );
  const handledSuccess = useRef(false);
  useGlobalPending(pending, "Confirmando programación…", "Actualizando el estado y la trazabilidad.");
  useEffect(() => {
    if (pending) {
      handledSuccess.current = false;
      return;
    }
    if (state.status === "success" && item && !handledSuccess.current) {
      handledSuccess.current = true;
      onUpdated("Programación confirmada correctamente.");
    }
  }, [item, onUpdated, pending, state.status]);
  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.button
            type="button"
            aria-label="Cerrar vista previa"
            className="fixed inset-0 z-[70] bg-black/35"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="fixed inset-y-0 right-0 z-[71] flex w-full max-w-lg flex-col border-l border-border bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="programming-preview-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                  <CalendarClock aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] text-foreground-muted">
                    PRG-{item.id.slice(0, 8).toUpperCase()}
                  </p>
                  <h2 id="programming-preview-title" className="mt-1 truncate font-semibold text-foreground">
                    {item.placementGroup || item.supplierName}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground"
                aria-label="Cerrar vista previa"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${programmingStatusTone(item.effectiveStatus)}`}>
                  {formatProgrammingStatus(item.effectiveStatus)}
                </span>
                <span className="text-xs text-foreground-muted">
                  {formatProgrammingDateTime(item.scheduledAt, timezone)}
                </span>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-6 rounded-xl border border-border bg-muted/30 p-4">
                <Detail label="Proveedor" value={item.supplierName} />
                {item.requiresPumping && <Detail label="Bombeo" value="Sí" />}
                {item.placementGroup && <Detail label="Grupo" value={item.placementGroup} />}
                {item.estimatedWorkItemLabel && (
                  <Detail label="Renglón" value={item.estimatedWorkItemLabel} />
                )}
                <Detail label="Creado por" value={item.createdByName} />
                <Detail
                  label="Persona que confirmó"
                  value={
                    item.confirmedAt
                      ? `${item.confirmedByName || "Usuario no disponible"} · ${formatProgrammingDateTime(item.confirmedAt, timezone)}`
                      : "Sin confirmar"
                  }
                />
              </dl>

              <section className="mt-5 overflow-hidden rounded-xl border border-border">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <PackageOpen aria-hidden="true" className="size-4 text-brand-strong" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Productos programados
                    </h3>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-foreground-muted">
                    {item.lines.length} {item.lines.length === 1 ? "línea" : "líneas"}
                  </span>
                </div>
                {item.lines.length ? (
                  <>
                    <div className="hidden grid-cols-[3rem_minmax(0,1fr)_5rem] gap-3 border-b border-border bg-muted/20 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted sm:grid">
                      <span>#</span>
                      <span>Cantidad</span>
                      <span>UM</span>
                    </div>
                    <ol className="divide-y divide-border">
                      {item.lines.map((line) => (
                        <li
                          key={line.id}
                          className="grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-center gap-3 px-4 py-3 text-sm"
                        >
                          <span className="font-mono text-xs font-semibold text-foreground-muted">
                            {line.position}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[10px] uppercase tracking-[0.06em] text-foreground-muted sm:hidden">
                              Cantidad
                            </span>
                            <span className="font-semibold text-foreground">
                              {formatProgrammingQuantity(line.quantity)}
                            </span>
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[10px] uppercase tracking-[0.06em] text-foreground-muted sm:hidden">
                              UM
                            </span>
                            <span className="font-semibold text-foreground">{line.unitCode}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-3 border-t border-border bg-muted/30 px-4 py-3 text-sm">
                      <span className="font-medium text-foreground-muted">Total solicitado</span>
                      <span className="font-semibold text-foreground">
                        {formatProgrammingQuantity(item.requestedQuantity)}
                      </span>
                      <span className="font-semibold text-foreground">{item.unitCode}</span>
                    </div>
                  </>
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-foreground-muted">
                    No fue posible resolver las líneas de esta programación.
                  </p>
                )}
              </section>

              <section className="mt-5 rounded-xl border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                  Notas
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {item.notes || "Sin notas registradas."}
                </p>
              </section>

              <section className="mt-5 overflow-hidden rounded-xl border border-border">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Truck aria-hidden="true" className="size-4 text-brand-strong" />
                    <h3 className="text-sm font-semibold text-foreground">Despachos relacionados</h3>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-foreground-muted">
                    {item.dispatches.length}
                  </span>
                </div>
                {item.dispatches.length ? (
                  <ul className="divide-y divide-border">
                    {item.dispatches.map((dispatch) => (
                      <li key={dispatch.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                        <span className="font-mono text-foreground">#{dispatch.id.slice(0, 8)}</span>
                        <span className="text-foreground-muted">{formatStatusLabel(dispatch.status)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-foreground-muted">
                    Todavía no hay despachos asociados.
                  </p>
                )}
              </section>
            </div>

            <div className="border-t border-border p-4 sm:p-5">
              {state.status === "error" && <p className="mb-3 rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive" role="alert">{state.message}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href={`/programming/${item.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted">
                  Ver detalle <ExternalLink aria-hidden="true" className="size-4" />
                </Link>
                {canDirectConfirm && canConfirm ? (
                  <form action={confirmAction}>
                    <input type="hidden" name="intent" value="confirm" />
                    <input type="hidden" name="projectId" value={item.projectId} />
                    <input type="hidden" name="programmingId" value={item.id} />
                    <input type="hidden" name="expectedVersion" value={item.version} />
                    <input type="hidden" name="confirmedQuantity" value={item.requestedQuantity} />
                    <LoadingButton loadingLabel="Confirmando…" className="primary-button w-full"><CheckCircle2 aria-hidden="true" className="size-4" /> Confirmar</LoadingButton>
                  </form>
                ) : null}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
