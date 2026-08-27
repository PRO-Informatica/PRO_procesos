"use client";

import { ArrowLeftRight, ChevronDown, LogOut, Menu } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/shared/theme-toggle";
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
    <header className="sticky top-0 z-30 flex h-20 items-center border-b border-border bg-surface/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenNavigation}
        className="mr-3 grid size-9 place-items-center rounded-lg border border-border text-foreground-muted hover:bg-muted hover:text-foreground lg:hidden"
        aria-label="Abrir navegación"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      <div className="min-w-0">
        <p className="truncate text-xs text-foreground-muted">PRO Procesos</p>
        <p className="truncate text-sm font-semibold text-foreground">Plataforma global</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {hasOperationalAccess && (
          <Link
            href="/"
            className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground-muted transition-colors hover:bg-muted hover:text-foreground sm:flex"
          >
            <ArrowLeftRight aria-hidden="true" className="size-4" />
            Ir a operación
          </Link>
        )}
        <ThemeToggle />

        <details className="group relative ml-1">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1.5 pr-2 transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
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

          <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg">
            {hasOperationalAccess && (
              <Link
                href="/"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground sm:hidden"
              >
                <ArrowLeftRight aria-hidden="true" className="size-4" />
                Ir a operación
              </Link>
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
