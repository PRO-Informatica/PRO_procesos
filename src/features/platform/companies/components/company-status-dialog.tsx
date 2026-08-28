"use client";

import { Power, PowerOff, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";

import { setCompanyStatus } from "../actions";
import { initialCompanyActionState, type CompanyStatus } from "../types";

export function CompanyStatusDialog({
  companyId,
  companyName,
  status,
  returnTo,
  compact = false,
}: {
  companyId: string;
  companyName: string;
  status: CompanyStatus;
  returnTo: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    setCompanyStatus,
    initialCompanyActionState,
  );
  const activating = status === "INACTIVE";
  useGlobalPending(
    pending,
    activating ? "Reactivando empresa…" : "Desactivando empresa…",
    "Estamos actualizando el acceso global de la empresa.",
  );

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
          activating
            ? "border-success/25 text-success hover:bg-success-soft"
            : "border-border text-foreground-muted hover:bg-muted hover:text-foreground"
        }`}
        whileTap={{ scale: 0.98 }}
        aria-label={`${activating ? "Activar" : "Desactivar"} ${companyName}`}
      >
        {activating ? (
          <Power aria-hidden="true" className="size-3.5" />
        ) : (
          <PowerOff aria-hidden="true" className="size-3.5" />
        )}
        {!compact && (activating ? "Activar" : "Desactivar")}
      </motion.button>

      <AnimatePresence>
        {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`company-status-title-${companyId}`}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
            initial={{ opacity: 0, scale: 0.98, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99, y: 2 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-start gap-4">
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                  activating
                    ? "bg-success-soft text-success"
                    : "bg-destructive-soft text-destructive"
                }`}
              >
                {activating ? (
                  <Power aria-hidden="true" className="size-5" />
                ) : (
                  <PowerOff aria-hidden="true" className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id={`company-status-title-${companyId}`}
                  className="text-lg font-semibold text-foreground"
                >
                  {activating ? "Reactivar empresa" : "Desactivar empresa"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-foreground-muted">
                  {activating
                    ? `${companyName} volverá a quedar activa.`
                    : `${companyName} quedará inactiva. Sus proyectos, usuarios, información e historial se conservarán; no se eliminará ningún registro.`}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label="Cerrar confirmación"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            {state.status === "error" && (
              <p
                className="mt-5 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {state.message}
              </p>
            )}

            <form action={formAction} className="mt-6 flex justify-end gap-3">
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="active" value={String(activating)} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground-muted hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <LoadingButton
                loadingLabel={activating ? "Reactivando…" : "Desactivando…"}
                className={`inline-flex min-w-28 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                  activating ? "bg-success" : "bg-destructive"
                }`}
              >
                {activating ? "Reactivar" : "Desactivar"}
              </LoadingButton>
            </form>
          </motion.section>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
