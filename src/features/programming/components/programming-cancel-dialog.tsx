"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { mutateProgrammingAction } from "../actions";
import { initialProgrammingMutationState, type ProgrammingItem } from "../types";

export function ProgrammingCancelDialog({ item, onClose, onCancelled }: {
  item: Pick<ProgrammingItem, "id" | "projectId" | "version">;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(mutateProgrammingAction, initialProgrammingMutationState);
  const handled = useRef(false);
  useActionNotification({ pending, status: state.status, success: notifications.programmingCancelled });
  useEffect(() => {
    if (state.status === "success" && !handled.current) {
      handled.current = true;
      onCancelled();
    }
  }, [onCancelled, state.status]);

  return (
    <Dialog title="Cancelar programación" description={`PRG-${item.id.slice(0, 8).toUpperCase()}`} tone="destructive" onClose={onClose} pending={pending} size="lg">
      <form action={action} aria-busy={pending}>
        <input type="hidden" name="intent" value="cancel" />
        <input type="hidden" name="projectId" value={item.projectId} />
        <input type="hidden" name="programmingId" value={item.id} />
        <input type="hidden" name="expectedVersion" value={item.version} />
        <div className="space-y-4 p-4 sm:p-6">
          <div>
            <label htmlFor="programming-cancel-reason" className="form-label">Motivo de cancelación *</label>
            <textarea id="programming-cancel-reason" name="reason" required maxLength={1000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} className="form-input resize-y" />
          </div>
          {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">{state.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Volver</Button>
          <LoadingButton variant="destructive" loading={pending} loadingLabel="Cancelando programación…" disabled={!reason.trim()}>Cancelar programación</LoadingButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
