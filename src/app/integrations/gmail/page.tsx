import { CheckCircle2 } from "lucide-react";
import { redirect } from "next/navigation";

import { GoogleLogo } from "@/components/brand/google-logo";
import { GmailOnboardingActions } from "@/features/integrations/gmail/components/gmail-onboarding-actions";
import {
  getAuthorizedGmailRequestUser,
  getGmailConnectionPublicStatus,
} from "@/features/integrations/gmail/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autorizar Gmail | PRO Procesos" };

const resultMessages: Record<string, { tone: string; text: string }> = {
  connected: {
    tone: "border-success/25 bg-success-soft text-success",
    text: "Gmail quedó autorizado correctamente.",
  },
  cancelled: {
    tone: "border-border bg-muted text-foreground-muted",
    text: "La autorización de Gmail fue cancelada.",
  },
  session_expired: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "La sesión expiró. Ingresa nuevamente.",
  },
  state_invalid: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "La solicitud de autorización ya no es válida. Inténtalo nuevamente.",
  },
  identity_rejected: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "La cuenta de Gmail no coincide con tu cuenta corporativa.",
  },
  scopes_incomplete: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "No se concedieron todos los permisos necesarios.",
  },
  refresh_token_required: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "Google no entregó una autorización renovable. Vuelve a conectar Gmail.",
  },
  start_failed: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "No fue posible iniciar la autorización de Gmail.",
  },
  connection_failed: {
    tone: "border-destructive/25 bg-destructive-soft text-destructive",
    text: "No fue posible completar la autorización de Gmail. Intenta nuevamente.",
  },
};

export default async function GmailOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const user = await getAuthorizedGmailRequestUser();
  if (!user) redirect("/auth/signout?reason=inactive");
  const [connection, params] = await Promise.all([
    getGmailConnectionPublicStatus(user.id),
    searchParams,
  ]);
  const message = params.result ? resultMessages[params.result] : null;
  const mergeConnectedMessage = connection.connected && params.result === "connected";

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-3 py-5 sm:px-6 sm:py-6">
      <section className="w-full min-w-0 max-w-lg overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-sm min-[420px]:p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-white">
            <GoogleLogo className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="break-words text-[11px] font-semibold uppercase tracking-[.14em] text-brand-strong min-[420px]:text-xs min-[420px]:tracking-[.16em]">
              Integración independiente
            </p>
            <h1 className="mt-1 break-words text-xl font-semibold tracking-tight text-foreground min-[420px]:text-2xl">
              {connection.status === "REAUTH_REQUIRED"
                ? "Reconecta Gmail"
                : connection.connected
                  ? "Conectado"
                  : "Conecta Gmail"}
            </h1>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-foreground-muted">
          Autoriza tu cuenta corporativa para consultar y enviar correos mediante Gmail.
          El servidor aplicará los remitentes y destinatarios permitidos por la configuración
          del sistema.
        </p>

        {message && !mergeConnectedMessage ? (
          <p className={`mt-4 break-words rounded-lg border px-3 py-2.5 text-sm ${message.tone}`} role="status">
            {message.text}
          </p>
        ) : null}

        <ul className="mt-4 space-y-2 text-sm text-foreground-muted">
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
            El servidor aplica los filtros y destinatarios autorizados.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
            Puedes desconectar Gmail cuando quieras sin cerrar tu sesión.
          </li>
        </ul>

        {connection.connected ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success-soft px-3 py-2.5 text-sm text-success"
            role={mergeConnectedMessage ? "status" : undefined}
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">
                {mergeConnectedMessage ? "Gmail quedó autorizado correctamente." : "Gmail conectado"}
              </p>
              <p className="mt-0.5 truncate text-xs">Conectado como {connection.email}</p>
            </div>
          </div>
        ) : null}

        <div className="mt-5 border-t border-border pt-4">
          <GmailOnboardingActions connection={connection} />
        </div>
      </section>
    </main>
  );
}
