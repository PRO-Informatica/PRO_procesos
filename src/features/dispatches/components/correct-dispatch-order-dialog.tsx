"use client";

import { CheckCircle2, PencilLine, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";

import { correctDispatchOrderNumberAction } from "../actions";
import {
  initialCorrectionMutationState,
  type DispatchDetail,
} from "../types";

export function CorrectDispatchOrderDialog({
  open,
  detail,
  onClose,
}: {
  open: boolean;
  detail: DispatchDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [state, action, pending] = useActionState(
    correctDispatchOrderNumberAction,
    initialCorrectionMutationState,
  );

  useGlobalPending(
    pending,
    "Corrigiendo pedido…",
    "Actualizando la guía y reconstruyendo el contexto de conciliación.",
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correct-order-title"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
        >
          <motion.div
            className="mx-auto mt-[10vh] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            initial={reduceMotion ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduceMotion ? undefined : { y: 8, opacity: 0 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div className="flex gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                  <PencilLine className="size-5" />
                </span>
                <div>
                  <h2 id="correct-order-title" className="font-semibold text-foreground">
                    Corregir número de pedido
                  </h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    La corrección quedará auditada y actualizará el lote automáticamente.
                  </p>
                </div>
              </div>
              <button type="button" onClick={onClose} disabled={pending} className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted" aria-label="Cerrar">
                <X className="size-5" />
              </button>
            </div>

            {state.status === "success" ? (
              <div className="grid place-items-center px-6 py-12 text-center">
                <CheckCircle2 className="size-12 text-success" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Pedido actualizado</h3>
                <p className="mt-2 text-sm text-foreground-muted">{state.message}</p>
                <button type="button" onClick={onClose} className="primary-button mt-6">Volver al detalle</button>
              </div>
            ) : (
              <form action={action} className="space-y-5 p-5 sm:p-6" aria-busy={pending}>
                <input type="hidden" name="projectId" value={detail.projectId} />
                <input type="hidden" name="dispatchId" value={detail.id} />
                <input type="hidden" name="programmingId" value={detail.programmingId} />
                <input type="hidden" name="expectedVersion" value={detail.version} />
                <div>
                  <label className="form-label" htmlFor="order-correction-number">Número de pedido *</label>
                  <input id="order-correction-number" name="orderNumber" required maxLength={120} defaultValue={detail.guideOrderNumber ?? ""} className="form-input" autoFocus />
                </div>
                <div>
                  <label className="form-label" htmlFor="order-correction-reason">Motivo de la corrección *</label>
                  <textarea id="order-correction-reason" name="reason" required maxLength={1000} rows={3} className="form-input resize-y" placeholder="Ej. El pedido no quedó registrado al crear el despacho." />
                </div>
                {state.status === "error" && <p role="alert" className="text-sm font-medium text-destructive">{state.message}</p>}
                <div className="flex justify-end gap-3 border-t border-border pt-5">
                  <button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cancelar</button>
                  <LoadingButton loadingLabel="Guardando…" className="primary-button">Guardar pedido</LoadingButton>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
