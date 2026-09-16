"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { GoogleLogo } from "@/components/brand/google-logo";
import { cn } from "@/lib/class-names";

import { GMAIL_CONNECTION_CHANGED_EVENT } from "../client-events";
import {
  getGmailIndicatorPresentation,
  type GmailIndicatorState,
} from "../indicator";
import type { GmailConnectionPublicStatus } from "../types";

const baseClass =
  "inline-flex h-9 w-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface md:w-36";

function isPublicStatus(value: unknown): value is GmailConnectionPublicStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GmailConnectionPublicStatus>;
  return (
    typeof candidate.connected === "boolean" &&
    ["CONNECTED", "REAUTH_REQUIRED", "DISCONNECTED", "NOT_CONNECTED"].includes(
      candidate.status ?? "",
    ) &&
    (candidate.email === null || typeof candidate.email === "string") &&
    (candidate.lastSyncAt === null || typeof candidate.lastSyncAt === "string")
  );
}

export function GmailConnectionIndicator() {
  const [state, setState] = useState<GmailIndicatorState>({ kind: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/integrations/gmail/status", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("GMAIL_STATUS_UNAVAILABLE");
        const connection: unknown = await response.json();
        if (!isPublicStatus(connection)) {
          throw new Error("GMAIL_STATUS_INVALID");
        }
        if (active) setState({ kind: "ready", connection });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setState({ kind: "error" });
        }
      }
    }

    void loadStatus();
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestVersion]);

  useEffect(() => {
    const refresh = () => {
      setState({ kind: "loading" });
      setRequestVersion((version) => version + 1);
    };
    window.addEventListener(GMAIL_CONNECTION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(GMAIL_CONNECTION_CHANGED_EVENT, refresh);
  }, []);

  const presentation = getGmailIndicatorPresentation(state);
  const label = <span className="hidden truncate md:inline">{presentation.label}</span>;

  if (state.kind === "loading") {
    return (
      <span
        aria-label={presentation.label}
        role="status"
        className={cn(baseClass, "border-border bg-muted text-foreground-muted")}
      >
        <GoogleLogo className="size-4" />
        {label}
      </span>
    );
  }

  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={() => {
          setState({ kind: "loading" });
          setRequestVersion((version) => version + 1);
        }}
        aria-label={`${presentation.label}. Reintentar`}
        title={`${presentation.label}. Reintentar`}
        className={cn(
          baseClass,
          "border-border bg-surface text-foreground-muted hover:bg-muted hover:text-foreground",
        )}
      >
        <GoogleLogo className="size-4" />
        {label}
      </button>
    );
  }

  const toneClass =
    presentation.tone === "connected"
      ? "border-success/25 bg-success-soft text-success hover:brightness-95"
      : presentation.tone === "reauth"
        ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        : "border-border bg-surface text-foreground-muted hover:bg-muted hover:text-foreground";

  return (
    <Link
      href="/integrations/gmail"
      aria-label={`${presentation.label}. Administrar conexión`}
      title={`${presentation.label}. Administrar conexión`}
      className={cn(baseClass, toneClass)}
    >
      <GoogleLogo className="size-4" />
      {label}
    </Link>
  );
}
