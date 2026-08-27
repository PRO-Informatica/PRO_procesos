"use client";

import { useActionState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";

import { updatePassword } from "../actions";
import { initialAuthActionState } from "../types";
import { AuthMessage } from "./auth-message";

export function UpdatePasswordForm() {
  const [state, formAction] = useActionState(
    updatePassword,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="form-label" htmlFor="password">
          Nueva contraseña
        </label>
        <input
          className="form-input"
          id="password"
          name="password"
          type="password"
          minLength={8}
          autoComplete="new-password"
          required
          autoFocus
        />
        <p className="mt-2 text-xs text-foreground-muted">Mínimo 8 caracteres.</p>
      </div>

      <div>
        <label className="form-label" htmlFor="passwordConfirmation">
          Confirmar contraseña
        </label>
        <input
          className="form-input"
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          minLength={8}
          autoComplete="new-password"
          required
        />
      </div>

      <AuthMessage state={state} />

      <LoadingButton className="primary-button w-full" loadingLabel="Actualizando…">
        Guardar contraseña
      </LoadingButton>
    </form>
  );
}
