"use client";

import { LogOut, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { GoogleLogo } from "@/components/brand/google-logo";
import { LoadingButton } from "@/components/feedback/loading-button";
import { buttonVariantClass } from "@/components/ui/button";
import { notify } from "@/lib/notify";

import { announceGmailConnectionChange } from "../client-events";
import type { GmailConnectionPublicStatus } from "../types";

export function GmailOnboardingActions({
  connection,
}: {
  connection: GmailConnectionPublicStatus;
}) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  async function disconnect() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/integrations/gmail/disconnect", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("DISCONNECT_FAILED");
      notify.success({
        title: "Gmail desconectado",
        description: "La autorización fue revocada en esta aplicación.",
      });
      announceGmailConnectionChange();
      router.refresh();
    } catch {
      notify.error({
        title: "No fue posible desconectar Gmail",
        description: "Inténtalo nuevamente.",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (connection.connected) {
    return (
      <div className="grid min-w-0 gap-2.5">
        <Link
          className={`${buttonVariantClass.primary} w-full gap-2 px-3 text-center leading-tight`}
          href="/"
        >
          <MailCheck aria-hidden="true" className="size-4 shrink-0" />
          Continuar a la aplicación
        </Link>
        <div className="grid min-w-0 gap-2.5 min-[420px]:grid-cols-2">
          <LoadingButton
            variant="secondary"
            className="w-full gap-2 px-3 leading-tight"
            loading={pending}
            loadingLabel="Desconectando…"
            onClick={disconnect}
          >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            Desconectar Gmail
          </LoadingButton>
          <SignOutAction />
        </div>
      </div>
    );
  }

  const reconnect =
    connection.status === "REAUTH_REQUIRED" || connection.status === "DISCONNECTED";
  return (
    <div className="grid min-w-0 gap-2.5 min-[420px]:grid-cols-2">
      <a
        className={`${buttonVariantClass.secondary} flex w-full min-w-0 items-center justify-center gap-2 bg-white px-3 text-center leading-tight text-[#1f1f1f]`}
        href="/api/integrations/gmail/connect"
      >
        <GoogleLogo className="size-5 shrink-0" />
        {reconnect ? "Reconectar con Google" : "Conectar con Google"}
      </a>
      <SignOutAction />
    </div>
  );
}

function SignOutAction() {
  return (
    <form action="/auth/signout" method="post">
      <button
        className={`${buttonVariantClass.ghost} flex w-full min-w-0 items-center justify-center gap-2 px-3 text-center leading-tight`}
        type="submit"
      >
        <LogOut aria-hidden="true" className="size-4 shrink-0" />
        Cerrar sesión
      </button>
    </form>
  );
}
