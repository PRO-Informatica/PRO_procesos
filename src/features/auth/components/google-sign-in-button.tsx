"use client";

import { useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

import { buildTrustedUrl, GOOGLE_IDENTITY_SCOPES, safeInternalPath } from "../security";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.86A6 6 0 0 1 6.07 12c0-.65.11-1.27.32-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.48l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
    </svg>
  );
}

export function GoogleSignInButton({ nextPath }: { nextPath: string }) {
  const pendingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setLoading(true);
    setMessage(null);

    try {
      const environment = getPublicEnvironment();
      const callbackUrl = buildTrustedUrl(environment.appUrl, "/auth/callback");
      callbackUrl.searchParams.set("next", safeInternalPath(nextPath));
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
          scopes: GOOGLE_IDENTITY_SCOPES,
          queryParams: { hd: "pro.com.gt" },
        },
      });

      if (error) {
        setMessage("No fue posible iniciar el acceso con Google.");
        pendingRef.current = false;
        setLoading(false);
      }
    } catch {
      setMessage("No fue posible iniciar el acceso con Google.");
      pendingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-foreground-muted">o continúa con</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <LoadingButton
        type="button"
        variant="secondary"
        className="w-full"
        loading={loading}
        loadingLabel="Conectando…"
        onClick={handleGoogleSignIn}
      >
        <GoogleIcon />
        Continuar con Google
      </LoadingButton>
      {message ? (
        <p className="text-sm text-destructive" role="alert" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
