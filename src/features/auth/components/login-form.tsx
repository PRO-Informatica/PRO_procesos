"use client";

import Link from "next/link";
import { useActionState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";

import { signIn } from "../actions";
import { initialAuthActionState } from "../types";
import type { AuthActionState } from "../types";
import { AuthMessage } from "./auth-message";

export function LoginForm({
  initialState,
  nextPath = "/",
}: {
  initialState?: AuthActionState;
  nextPath?: string;
}) {
  const [state, formAction] = useActionState(
    signIn,
    initialState ?? initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={nextPath} />
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

      <div>
        <div className="mb-2 flex items-center justify-between gap-4">
          <label className="form-label mb-0" htmlFor="password">
            Contraseña
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-brand-strong hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <input
          className="form-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <AuthMessage state={state} />

      <LoadingButton className="primary-button w-full" loadingLabel="Verificando…">
        Ingresar
      </LoadingButton>
    </form>
  );
}
