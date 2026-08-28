"use client";

import { MailPlus, UserPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { LoadingButton } from "@/components/feedback/loading-button";

import { invitePlatformUser } from "../actions";
import { initialPlatformUserActionState } from "../types";

function InviteUserForm({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(
    invitePlatformUser,
    initialPlatformUserActionState,
  );
  useGlobalPending(
    pending,
    "Invitando usuario…",
    "Estamos creando el acceso y enviando la invitación segura.",
  );

  return (
    <>
      <motion.div
        className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"
        role="presentation"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !pending) onClose();
        }}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-user-title"
          className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl"
          initial={{ opacity: 0, scale: 0.98, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.99, y: 2 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              <MailPlus aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="invite-user-title" className="text-lg font-semibold text-foreground">
                Invitar usuario
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-foreground-muted">
                Supabase enviará un correo de invitación. No se solicitará ni almacenará una contraseña.
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label="Cerrar invitación"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <form action={formAction} className="mt-6 space-y-5">
            <div>
              <label htmlFor="invite-full-name" className="form-label">
                Nombre completo
              </label>
              <input
                id="invite-full-name"
                name="fullName"
                required
                minLength={2}
                maxLength={160}
                defaultValue={state.fields?.fullName}
                className="form-input"
                autoComplete="name"
                placeholder="Nombre del usuario"
              />
            </div>
            <div>
              <label htmlFor="invite-email" className="form-label">
                Correo electrónico
              </label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                maxLength={254}
                defaultValue={state.fields?.email}
                className="form-input"
                autoComplete="email"
                placeholder="usuario@empresa.com"
              />
            </div>

            {state.status !== "idle" && (
              <motion.p
                className={`rounded-lg px-4 py-3 text-sm ${
                  state.status === "success"
                    ? "bg-success-soft text-success"
                    : "bg-destructive-soft text-destructive"
                }`}
                role={state.status === "error" ? "alert" : "status"}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {state.message}
              </motion.p>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground-muted hover:bg-muted disabled:opacity-50"
              >
                {state.status === "success" ? "Cerrar" : "Cancelar"}
              </button>
              {state.status !== "success" && (
                <LoadingButton loadingLabel="Invitando…" className="primary-button min-w-32">
                  Enviar invitación
                </LoadingButton>
              )}
            </div>
          </form>
        </motion.section>
      </motion.div>
    </>
  );
}

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className="primary-button shrink-0 gap-2"
        whileTap={{ scale: 0.98 }}
      >
        <UserPlus aria-hidden="true" className="size-4" />
        Invitar usuario
      </motion.button>
      <AnimatePresence>
        {open && <InviteUserForm onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
