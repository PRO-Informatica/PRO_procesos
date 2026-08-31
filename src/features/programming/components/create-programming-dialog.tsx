"use client";

import { CalendarPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";

import { createProgrammingAction } from "../actions";
import {
  initialCreateProgrammingState,
  type ProgrammingSupplier,
  type ProgrammingUnit,
} from "../types";
import { ProgrammingLinesFields } from "./programming-lines-fields";

function splitScheduledAt(value: string) {
  const [date = "", time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

export function CreateProgrammingDialog({
  open,
  projectId,
  timezone,
  suppliers,
  units,
  initialScheduledAt,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  timezone: string;
  suppliers: ProgrammingSupplier[];
  units: ProgrammingUnit[];
  initialScheduledAt: string;
  onClose: () => void;
  onCreated: (programmingId: string) => void;
}) {
  const initialParts = splitScheduledAt(initialScheduledAt);
  const [scheduledDate, setScheduledDate] = useState(initialParts.date);
  const [scheduledTime, setScheduledTime] = useState(initialParts.time);
  const [state, formAction, pending] = useActionState(
    createProgrammingAction,
    initialCreateProgrammingState,
  );
  useGlobalPending(
    pending,
    "Creando programación…",
    "Se guardará como borrador sin confirmarla automáticamente.",
  );

  useEffect(() => {
    if (state.status === "success" && state.programmingId) {
      onCreated(state.programmingId);
    }
  }, [onCreated, state.programmingId, state.status]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-programming-title"
        >
          <motion.div
            className="my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                  <CalendarPlus aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2 id="new-programming-title" className="font-semibold text-foreground">
                    Nueva programación
                  </h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Fecha y hora en {timezone}. Estado inicial: Borrador.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label="Cerrar formulario"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <form action={formAction} aria-busy={pending}>
              <input type="hidden" name="projectId" value={projectId} />
              <input
                type="hidden"
                name="scheduledAt"
                value={
                  scheduledDate && scheduledTime
                    ? `${scheduledDate}T${scheduledTime}`
                    : ""
                }
              />
              <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
                <div className="sm:col-span-2">
                  <span className="form-label">Proveedor</span>
                  {suppliers.length === 1 ? (
                    <>
                      <input type="hidden" name="supplierId" value={suppliers[0].id} />
                      <div className="flex min-h-11 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm font-medium text-foreground">
                        {suppliers[0].code} · {suppliers[0].name}
                      </div>
                    </>
                  ) : (
                    <select
                      id="programming-supplier"
                      name="supplierId"
                      required
                      defaultValue={state.fields?.supplierId ?? ""}
                      className="form-input"
                      aria-label="Proveedor"
                    >
                      <option value="">Selecciona un proveedor</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.code} · {supplier.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-3 min-[460px]:grid-cols-2">
                  <div className="min-w-0">
                    <label htmlFor="programming-scheduled-date" className="form-label">
                      Fecha
                    </label>
                    <input
                      id="programming-scheduled-date"
                      type="date"
                      required
                      value={scheduledDate}
                      onChange={(event) => setScheduledDate(event.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="programming-scheduled-time" className="form-label">
                      Hora
                    </label>
                    <input
                      id="programming-scheduled-time"
                      type="time"
                      required
                      value={scheduledTime}
                      onChange={(event) => setScheduledTime(event.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>

                <ProgrammingLinesFields
                  units={units}
                  initialLines={state.fields?.lines}
                  disabled={pending}
                />

                <div className="sm:col-span-2">
                  <label htmlFor="programming-notes" className="form-label">
                    Notas
                  </label>
                  <textarea
                    id="programming-notes"
                    name="notes"
                    rows={3}
                    maxLength={1000}
                    defaultValue={state.fields?.notes}
                    className="form-input resize-y"
                    placeholder="Observaciones opcionales"
                  />
                </div>

                {state.status === "error" && (
                  <p
                    className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive sm:col-span-2"
                    role="alert"
                  >
                    {state.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  Cancelar
                </button>
                <LoadingButton loadingLabel="Creando borrador…">
                  Crear programación
                </LoadingButton>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
