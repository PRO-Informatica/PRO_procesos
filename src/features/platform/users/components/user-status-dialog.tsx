"use client";

import { Power, PowerOff, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { LoadingButton } from "@/components/feedback/loading-button";

import { setPlatformUserStatus } from "../actions";
import { initialPlatformUserActionState } from "../types";

export function UserStatusDialog({
  userId,
  userName,
  active,
  compact = false,
  disabled = false,
}: {
  userId: string;
  userName: string;
  active: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    setPlatformUserStatus,
    initialPlatformUserActionState,
  );
  const activating = !active;
  useGlobalPending(
    pending,
    "Actualizando usuario…",
    "Estamos aplicando el cambio sin eliminar memberships ni historial.",
  );

  return (
    <>
      <motion.button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
          activating
            ? "border-success/25 text-success hover:bg-success-soft"
            : "border-border text-foreground-muted hover:bg-muted hover:text-foreground"
        }`}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        title={disabled ? "No puedes desactivar tu propio usuario" : undefined}
        aria-label={`${activating ? "Activar" : "Desactivar"} ${userName}`}
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
          <>
            <motion.div
              className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"
              role="presentation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !pending) setOpen(false);
              }}
            >
              <motion.section
                role="dialog"
                aria-modal="true"
                aria-labelledby={`user-status-title-${userId}`}
                className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
                initial={{ opacity: 0, scale: 0.98, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.99, y: 2 }}
              >
                <div className="flex items-start gap-4">
                  <span
                    className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                      activating
                        ? "bg-success-soft text-success"
                        : "bg-destructive-soft text-destructive"
                    }`}
                  >
                    {activating ? <Power className="size-5" /> : <PowerOff className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id={`user-status-title-${userId}`} className="text-lg font-semibold text-foreground">
                      {activating ? "Activar usuario" : "Desactivar usuario"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-foreground-muted">
                      {activating
                        ? `${userName} recuperará su acceso funcional respetando sus memberships y roles actuales.`
                        : `${userName} perderá acceso funcional, pero conservará todo su historial, memberships y roles.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setOpen(false)}
                    className="grid size-8 place-items-center rounded-lg text-foreground-muted hover:bg-muted disabled:opacity-50"
                    aria-label="Cerrar confirmación"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </div>

                {state.status !== "idle" && (
                  <p
                    className={`mt-5 rounded-lg px-3 py-2 text-sm ${
                      state.status === "success"
                        ? "bg-success-soft text-success"
                        : "bg-destructive-soft text-destructive"
                    }`}
                    role={state.status === "error" ? "alert" : "status"}
                  >
                    {state.message}
                  </p>
                )}

                <form action={formAction} className="mt-6 flex justify-end gap-3">
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="active" value={String(activating)} />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground-muted hover:bg-muted disabled:opacity-50"
                  >
                    Cerrar
                  </button>
                  {state.status !== "success" && (
                    <LoadingButton
                      loadingLabel={activating ? "Activando…" : "Desactivando…"}
                      className={`inline-flex min-w-28 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                        activating ? "bg-success" : "bg-destructive"
                      }`}
                    >
                      {activating ? "Activar" : "Desactivar"}
                    </LoadingButton>
                  )}
                </form>
              </motion.section>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
