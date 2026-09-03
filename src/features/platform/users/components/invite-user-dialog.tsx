"use client";

import { KeyRound, MailPlus, UserPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { LoadingButton } from "@/components/feedback/loading-button";

import { createPlatformUserWithPassword, invitePlatformUser } from "../actions";
import { initialPlatformUserActionState } from "../types";

type CreationMode = "password" | "invite";

function UserCreationForm({
  mode,
  onModeChange,
  onClose,
}: {
  mode: CreationMode;
  onModeChange: (mode: CreationMode) => void;
  onClose: () => void;
}) {
  const directCreation = mode === "password";
  const [state, formAction, pending] = useActionState(
    directCreation ? createPlatformUserWithPassword : invitePlatformUser,
    initialPlatformUserActionState,
  );
  useGlobalPending(
    pending,
    directCreation ? "Creando usuario…" : "Invitando usuario…",
    directCreation
      ? "Estamos creando una cuenta con acceso inmediato."
      : "Estamos creando el acceso y enviando la invitación segura.",
  );

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/45 p-4"
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
        aria-labelledby="create-user-title"
        className="my-auto w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        initial={{ opacity: 0, scale: 0.98, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.99, y: 2 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
            {directCreation ? (
              <KeyRound aria-hidden="true" className="size-5" />
            ) : (
              <MailPlus aria-hidden="true" className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="create-user-title" className="text-lg font-semibold text-foreground">
              Agregar usuario
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-foreground-muted">
              {directCreation
                ? "Crea la cuenta con una contraseña inicial, sin enviar correos."
                : "Supabase enviará un correo para que el usuario active su cuenta."}
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Cerrar creación de usuario"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 rounded-xl bg-muted p-1" aria-label="Método de creación">
          <button
            type="button"
            disabled={pending}
            onClick={() => onModeChange("password")}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              directCreation
                ? "bg-surface text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            Con contraseña
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onModeChange("invite")}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              !directCreation
                ? "bg-surface text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            Por invitación
          </button>
        </div>

        <form action={formAction} className="mt-5 space-y-5">
          <div>
            <label htmlFor={`user-full-name-${mode}`} className="form-label">
              Nombre completo
            </label>
            <input
              id={`user-full-name-${mode}`}
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
            <label htmlFor={`user-email-${mode}`} className="form-label">
              Correo electrónico
            </label>
            <input
              id={`user-email-${mode}`}
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

          {directCreation && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="create-user-password" className="form-label">
                  Contraseña
                </label>
                <input
                  id="create-user-password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  className="form-input"
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div>
                <label htmlFor="create-user-password-confirmation" className="form-label">
                  Confirmar contraseña
                </label>
                <input
                  id="create-user-password-confirmation"
                  name="passwordConfirmation"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  className="form-input"
                  autoComplete="new-password"
                  placeholder="Repite la contraseña"
                />
              </div>
            </div>
          )}

          {directCreation && state.status === "idle" && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/35 dark:text-amber-300">
              La cuenta quedará confirmada y podrá iniciar sesión inmediatamente. Comparte la contraseña por un medio seguro.
            </p>
          )}

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
              <LoadingButton
                loadingLabel={directCreation ? "Creando…" : "Invitando…"}
                className="primary-button min-w-36"
              >
                {directCreation ? "Crear usuario" : "Enviar invitación"}
              </LoadingButton>
            )}
          </div>
        </form>
      </motion.section>
    </motion.div>
  );
}

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CreationMode>("password");

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className="primary-button shrink-0 gap-2"
        whileTap={{ scale: 0.98 }}
      >
        <UserPlus aria-hidden="true" className="size-4" />
        Agregar usuario
      </motion.button>
      <AnimatePresence>
        {open && (
          <UserCreationForm
            key={mode}
            mode={mode}
            onModeChange={setMode}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
