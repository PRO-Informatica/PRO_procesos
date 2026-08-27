"use client";

import Link from "next/link";
import { useActionState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";

import { requestPasswordReset } from "../actions";
import { initialAuthActionState } from "../types";
import { AuthMessage } from "./auth-message";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    requestPasswordReset,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="form-label" htmlFor="email">
          Correo electrónico
        </label>
        <input
          className="form-input"
          defaultValue={state.fields?.email}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="nombre@empresa.com"
          required
          autoFocus
        />
      </div>

      <AuthMessage state={state} />

      <LoadingButton className="primary-button w-full" loadingLabel="Enviando…">
        Enviar instrucciones
      </LoadingButton>

      <Link
        href="/login"
        className="block text-center text-sm font-medium text-foreground-muted hover:text-foreground"
      >
        Volver al inicio de sesión
      </Link>
    </form>
  );
}
