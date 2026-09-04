"use client";

import { Clock3, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

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
  useActionNotification({
    pending,
    status: state.status,
    success: notifications.dispatchStarted,
    error: notifications.actionFailed,
  });
  useEffect(() => {
    if (state.status === "success" && state.dispatchId) {
      router.push(`/dispatches/${state.dispatchId}`);
      router.refresh();
    }
  }, [router, state]);

  return (
    <Dialog title="Iniciar despacho" description="Se creará el despacho operativo de esta programación." icon={Truck} onClose={onClose} pending={pending}>
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
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
            <LoadingButton loadingLabel="Iniciando…">Iniciar despacho</LoadingButton>
          </DialogFooter>
        </form>
    </Dialog>
  );
}
