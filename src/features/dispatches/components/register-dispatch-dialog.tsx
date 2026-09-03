"use client";

import { Clock3, Truck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";

import { startDispatchAction } from "../actions";
import { formatDispatchDateTime, formatDispatchQuantity } from "../formatters";
import {
  initialDispatchMutationState,
  type ProgrammingDispatchItem,
} from "../types";

function localTimeNow(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

function programmingDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function StartDispatchDialog({
  projectId,
  timezone,
  receiverName,
  programming,
  onClose,
}: {
  projectId: string;
  timezone: string;
  receiverName: string;
  programming: ProgrammingDispatchItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const scheduledDate = programmingDate(programming.scheduledAt, timezone);
  const [arrivalTime, setArrivalTime] = useState(localTimeNow(timezone));
  const [state, action, pending] = useActionState(
    startDispatchAction,
    initialDispatchMutationState,
  );
  useEffect(() => {
    if (state.status === "success" && state.dispatchId) {
      router.push(`/dispatches/${state.dispatchId}`);
      router.refresh();
    }
  }, [router, state]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Truck className="size-5" /></span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Iniciar despacho</h2>
              <p className="mt-1 text-sm text-foreground-muted">Se creará el único despacho operativo de esta programación.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={pending} className="grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        <form action={action}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="programmingId" value={programming.programmingId} />
          <input type="hidden" name="arrivalAt" value={`${scheduledDate}T${arrivalTime}`} />
          <div className="space-y-5 p-5 sm:p-6">
            <dl className="grid gap-4 rounded-xl border border-border bg-muted/25 p-4 sm:grid-cols-2">
              <div><dt className="text-xs text-foreground-muted">Programación</dt><dd className="mt-1 font-mono text-sm font-semibold">{programming.programmingCode}</dd></div>
              <div><dt className="text-xs text-foreground-muted">Proveedor</dt><dd className="mt-1 text-sm font-semibold">{programming.supplierName}</dd></div>
              <div><dt className="text-xs text-foreground-muted">Fecha</dt><dd className="mt-1 text-sm font-semibold">{formatDispatchDateTime(programming.scheduledAt, timezone)}</dd></div>
              <div><dt className="text-xs text-foreground-muted">Volumen programado</dt><dd className="mt-1 text-sm font-semibold">{formatDispatchQuantity(programming.programmedVolume)} {programming.unitCode}</dd></div>
            </dl>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="start-arrival" className="form-label">Hora de llegada *</label>
                <div className="relative"><Clock3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" /><input id="start-arrival" type="time" required value={arrivalTime} onChange={(event) => setArrivalTime(event.target.value)} className="form-input pl-10" /></div>
                <p className="mt-1 text-xs text-foreground-muted">Inicio de la primera entrega · {scheduledDate}.</p>
              </div>
              <div>
                <label htmlFor="start-receiver" className="form-label">Receptor *</label>
                <input id="start-receiver" name="receivedByName" required maxLength={160} defaultValue={receiverName} className="form-input" />
              </div>
            </div>
            {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Cancelar</button>
            <LoadingButton loadingLabel="Iniciando…">Iniciar despacho</LoadingButton>
          </div>
        </form>
      </div>
    </div>
  );
}
