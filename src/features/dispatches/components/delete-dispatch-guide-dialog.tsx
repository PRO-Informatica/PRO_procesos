"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { deleteDispatchGuideAction } from "../actions";
import { initialDispatchMutationState, type DispatchGuide } from "../types";

export function DeleteDispatchGuideDialog({
  projectId,
  programmingId,
  dispatchId,
  expectedVersion,
  guide,
  onClose,
}: {
  projectId: string;
  programmingId: string;
  dispatchId: string;
  expectedVersion: number;
  guide: DispatchGuide;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    deleteDispatchGuideAction,
    initialDispatchMutationState,
  );
  useActionNotification({
    pending,
    status: state.status,
    success: notifications.guideRemoved,
    error: { ...notifications.actionFailed, description: state.message },
  });

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.status]);

  return (
    <Dialog
      title="¿Eliminar guía?"
      description={`Se eliminará la guía ${guide.guideNumber} de este despacho.`}
      icon={Trash2}
      onClose={onClose}
      pending={pending}
      tone="destructive"
      size="sm"
    >
      <form action={formAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="programmingId" value={programmingId} />
        <input type="hidden" name="dispatchId" value={dispatchId} />
        <input type="hidden" name="guideId" value={guide.id} />
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
        <div className="space-y-3 p-5 text-sm sm:p-6">
          <p className="leading-6 text-foreground-muted">
            Se eliminarán sus líneas de productos y servicios y se actualizarán el
            total según guías y las estimaciones de facturación. El volumen real
            no se modificará. Esta acción no se puede deshacer.
          </p>
          <p className="text-xs leading-5 text-foreground-muted">
            Si tiene evidencia vinculada, debes retirarla primero.
          </p>
          {state.status === "error" && (
            <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">
              {state.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <LoadingButton variant="destructive" loadingLabel="Eliminando…" disabled={pending}>
            Eliminar guía
          </LoadingButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
