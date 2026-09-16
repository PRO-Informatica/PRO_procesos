"use client";

import { useRef, useState } from "react";

import { GoogleLogo } from "@/components/brand/google-logo";
import { LoadingButton } from "@/components/feedback/loading-button";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

import { buildTrustedUrl, GOOGLE_IDENTITY_SCOPES, safeInternalPath } from "../security";

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
        <GoogleLogo />
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
