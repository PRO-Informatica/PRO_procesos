"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { mutateProgrammingAction } from "../actions";
import {
  initialProgrammingMutationState,
  type ProgrammingItem,
  type ProgrammingSupplier,
  type ProgrammingUnit,
} from "../types";
import { ProgrammingLinesFields } from "./programming-lines-fields";

function zonedInputValue(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function ProgrammingEditDialog({
  item,
  suppliers,
  units,
  timezone,
  onClose,
  onUpdated,
}: {
  item: ProgrammingItem;
  suppliers: ProgrammingSupplier[];
  units: ProgrammingUnit[];
  timezone: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    mutateProgrammingAction,
    initialProgrammingMutationState,
  );
  const handledSuccess = useRef(false);

  useActionNotification({
    pending,
    status: state.status,
    success: notifications.programmingUpdated,
  });

  useEffect(() => {
    if (pending) {
      handledSuccess.current = false;
      return;
    }
    if (state.status === "success" && !handledSuccess.current) {
      handledSuccess.current = true;
      router.refresh();
      onUpdated();
    } else if (state.conflict) {
      router.refresh();
    }
  }, [onUpdated, pending, router, state.conflict, state.status]);

  return (
    <Dialog
      title="Editar programación"
      description={`PRG-${item.id.slice(0, 8).toUpperCase()} · al guardar volverá a Pendiente de confirmación`}
      onClose={onClose}
      pending={pending}
      size="lg"
    >
      <form action={formAction} aria-busy={pending}>
        <input type="hidden" name="intent" value="edit" />
        <input type="hidden" name="projectId" value={item.projectId} />
        <input type="hidden" name="programmingId" value={item.id} />
        <input type="hidden" name="expectedVersion" value={item.version} />

        <div className="grid gap-5 p-5 sm:p-6">
          <div>
            <label htmlFor="edit-programming-supplier" className="form-label">
              Proveedor
            </label>
            <select
              id="edit-programming-supplier"
              name="supplierId"
              defaultValue={item.supplierId}
              required
              className="form-input"
              disabled={pending}
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.code} · {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="edit-programming-scheduled" className="form-label">
              Fecha y hora
            </label>
            <input
              id="edit-programming-scheduled"
              name="scheduledAt"
              type="datetime-local"
              required
              defaultValue={zonedInputValue(item.scheduledAt, timezone)}
              className="form-input"
              disabled={pending}
            />
            <p className="mt-1 text-xs text-foreground-muted">Zona horaria: {timezone}</p>
          </div>

          <div>
            <label htmlFor="edit-programming-order-number" className="form-label">
              Pedido No.
            </label>
            <input
              id="edit-programming-order-number"
              name="orderNumber"
              required
              maxLength={120}
              defaultValue={item.orderNumber ?? ""}
              className="form-input"
              disabled={pending}
            />
          </div>

          <ProgrammingLinesFields
            units={units}
            initialLines={item.lines.map((line) => ({
              quantity: String(line.quantity),
              unitCode: line.unitCode,
              concreteType: line.concreteType ?? "",
            }))}
            disabled={pending}
          />

          <div>
            <label htmlFor="edit-programming-notes" className="form-label">
              Notas
            </label>
            <textarea
              id="edit-programming-notes"
              name="notes"
              rows={3}
              maxLength={1000}
              defaultValue={item.notes ?? ""}
              className="form-input resize-y"
              disabled={pending}
            />
          </div>

          <div>
            <label htmlFor="edit-programming-reason" className="form-label">
              Motivo de edición *
            </label>
            <textarea
              id="edit-programming-reason"
              name="reason"
              required
              rows={4}
              maxLength={1000}
              className="form-input resize-y"
              disabled={pending}
              placeholder="Explica por qué se modifica la programación"
            />
            <p className="mt-1 text-xs text-foreground-muted">
              El motivo quedará registrado en el historial y la programación deberá confirmarse nuevamente.
            </p>
          </div>

          {state.status === "error" && (
            <div
              className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <p>{state.message}</p>
              {state.conflict && (
                <p className="mt-1 font-medium">
                  Se recargó la versión vigente. Revisa los cambios antes de intentarlo de nuevo.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Volver
          </Button>
          <LoadingButton loadingLabel="Guardando cambios…">
            Guardar y enviar a confirmación
          </LoadingButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
