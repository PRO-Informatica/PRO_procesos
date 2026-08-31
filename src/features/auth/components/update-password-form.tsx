"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { createClient } from "@/lib/supabase/client";

import { updatePassword } from "../actions";
import { initialAuthActionState } from "../types";
import { AuthMessage } from "./auth-message";

export function UpdatePasswordForm({
  hasRecoverySession,
}: {
  hasRecoverySession: boolean;
}) {
  const router = useRouter();
  const [checkingRecovery, setCheckingRecovery] = useState(true);
  const [recoveryEstablished, setRecoveryEstablished] = useState(false);
  const [state, formAction] = useActionState(
    updatePassword,
    initialAuthActionState,
  );

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = parameters.get("access_token");
    const refreshToken = parameters.get("refresh_token");
    const type = parameters.get("type");

    if (!accessToken || !refreshToken || type !== "recovery") {
      const timer = window.setTimeout(() => setCheckingRecovery(false), 0);
      return () => window.clearTimeout(timer);
    }

    let active = true;

    void createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (!active) return;

        window.history.replaceState(null, "", "/reset-password");
        if (error) {
          setCheckingRecovery(false);
          return;
        }

        setRecoveryEstablished(true);
        setCheckingRecovery(false);
        router.refresh();
      })
      .catch(() => {
        if (!active) return;
        window.history.replaceState(null, "", "/reset-password");
        setCheckingRecovery(false);
      });

    return () => {
      active = false;
    };
  }, [hasRecoverySession, router]);

  if (checkingRecovery) {
    return (
      <p className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground-muted" role="status">
        Validando el enlace de recuperación…
      </p>
    );
  }

  if (!hasRecoverySession && !recoveryEstablished) {
    return (
      <div className="space-y-5">
        <AuthMessage
          state={{
            status: "error",
            message:
              "El enlace de recuperación ya no es válido o ha expirado. Solicita uno nuevo.",
          }}
        />
        <Link href="/forgot-password" className="primary-button flex w-full justify-center">
          Solicitar un enlace nuevo
        </Link>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="space-y-5">
        <AuthMessage state={state} />
        <Link href="/login" className="primary-button flex w-full justify-center">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

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
          maxLength={128}
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
          maxLength={128}
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
