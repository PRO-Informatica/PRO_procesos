import type { GmailConnectionPublicStatus } from "./types.ts";

export type GmailIndicatorState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; connection: GmailConnectionPublicStatus };

export function getGmailIndicatorPresentation(state: GmailIndicatorState) {
  if (state.kind === "loading") {
    return { label: "Consultando estado de Gmail", tone: "loading" } as const;
  }
  if (state.kind === "error") {
    return { label: "Estado no disponible", tone: "error" } as const;
  }
  if (state.connection.status === "CONNECTED") {
    return { label: "Conectado", tone: "connected" } as const;
  }
  if (state.connection.status === "REAUTH_REQUIRED") {
    return { label: "Reconectar Gmail", tone: "reauth" } as const;
  }
  return { label: "Conectar Gmail", tone: "disconnected" } as const;
}
