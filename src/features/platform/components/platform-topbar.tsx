"use client";

import { ArrowLeftRight, ChevronDown, LogOut, Menu } from "lucide-react";

import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ScopeSwitchLink } from "@/components/shared/scope-switch-link";
import { signOut } from "@/features/auth/actions";
import type { SessionProfile } from "@/features/auth/types";
import { usePlatformContext } from "@/features/platform/platform-context";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function PlatformTopbar({
  profile,
  onOpenNavigation,
}: {
  profile: SessionProfile;
  onOpenNavigation: () => void;
}) {
  const { hasOperationalAccess } = usePlatformContext();

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center border-b border-border bg-surface/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-sm sm:h-20 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenNavigation}
        className="mr-2 grid size-11 shrink-0 place-items-center rounded-lg border border-border text-foreground-muted transition-colors hover:bg-muted hover:text-foreground active:bg-muted lg:hidden sm:mr-3"
        aria-label="Abrir navegación"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      <div className="min-w-0">
        <p className="truncate text-xs text-foreground-muted">PRO Procesos</p>
        <p className="truncate text-sm font-semibold text-foreground">Plataforma global</p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {hasOperationalAccess && (
          <ScopeSwitchLink
            href="/"
            loadingLabel="Cambiando a operación…"
            className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground-muted transition-colors hover:bg-muted hover:text-foreground sm:flex"
          >
            <ArrowLeftRight aria-hidden="true" className="size-4" />
            Ir a operación
          </ScopeSwitchLink>
        )}
        <ThemeToggle />

        <details className="group relative ml-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-muted active:bg-muted sm:pr-2 [&::-webkit-details-marker]:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-xs font-bold text-brand-strong">
              {initials(profile.fullName)}
            </span>
            <span className="hidden max-w-36 text-left sm:block">
              <span className="block truncate text-xs font-semibold text-foreground">
                {profile.fullName}
              </span>
              <span className="block truncate text-[11px] text-foreground-muted">
                {profile.email}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="hidden size-3.5 text-foreground-muted transition-transform group-open:rotate-180 sm:block"
            />
          </summary>

          <div className="menu-popover absolute right-0 mt-2 w-[min(14rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-surface p-2 shadow-lg">
            {hasOperationalAccess && (
              <ScopeSwitchLink
                href="/"
                loadingLabel="Cambiando a operación…"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground sm:hidden"
              >
                <ArrowLeftRight aria-hidden="true" className="size-4" />
                Ir a operación
              </ScopeSwitchLink>
            )}
            <form action={signOut}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut aria-hidden="true" className="size-4" />
                Cerrar sesión
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
