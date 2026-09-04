"use client";

import { CalendarPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

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

function todayInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
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
  useActionNotification({ pending, status: state.status, success: notifications.programmingCreated });

  useEffect(() => {
    if (state.status === "success" && state.programmingId) {
      onCreated(state.programmingId);
    }
  }, [onCreated, state.programmingId, state.status]);

  if (!open) return null;
  return (
    <Dialog title="Nueva programación" description={`Fecha y hora en ${timezone}. Estado inicial: Pendiente de confirmación.`} icon={CalendarPlus} onClose={onClose} pending={pending} size="lg">
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
                      min={todayInTimezone(timezone)}
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

              <DialogFooter>
                <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
                <LoadingButton loadingLabel="Creando programación…">
                  Crear programación
                </LoadingButton>
              </DialogFooter>
            </form>
    </Dialog>
  );
}
