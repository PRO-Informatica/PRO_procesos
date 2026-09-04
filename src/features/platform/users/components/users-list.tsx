import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionSection } from "@/components/motion/motion-section";

import { formatUserDate } from "../formatters";
import type { PlatformUserListFilters, PlatformUserListResult } from "../types";
import { InviteUserDialog } from "./invite-user-dialog";
import { UserAvatar } from "./user-avatar";
import {
  UserAuthStatusBadge,
  UserProfileStatusBadge,
} from "./user-status-badge";
import { UserStatusDialog } from "./user-status-dialog";

function pageHref(filters: PlatformUserListFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.query) params.set("search", filters.query);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/platform/users?${query}` : "/platform/users";
}

export function UsersList({
  result,
  filters,
}: {
  result: PlatformUserListResult;
  filters: PlatformUserListFilters;
}) {
  const filtered = Boolean(filters.query || filters.status !== "ALL");

  return (
    <div className="mx-auto max-w-[1440px]">
      <MotionSection className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
            Administración global
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Usuarios
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Administración global de usuarios de la plataforma.
          </p>
        </div>
        <InviteUserDialog />
      </MotionSection>

      <MotionSection className="mt-6">
        <form
          action="/platform/users"
          method="get"
          className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_13rem_auto]"
        >
          <label className="relative block">
            <span className="sr-only">Buscar usuarios</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted"
            />
            <input
              type="search"
              name="search"
              defaultValue={filters.query}
              maxLength={100}
              placeholder="Buscar por nombre o email"
              className="form-input h-11 pl-10"
            />
          </label>
          <label>
            <span className="sr-only">Filtrar por estado</span>
            <select
              name="status"
              defaultValue={filters.status}
              className="form-input h-11"
            >
              <option value="ALL">Todos los estados</option>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos</option>
            </select>
          </label>
          <button type="submit" className="primary-button h-11">
            Aplicar filtros
          </button>
        </form>
      </MotionSection>

      <div className="mt-4 flex items-center justify-between text-xs text-foreground-muted">
        <p>
          {result.total} {result.total === 1 ? "usuario encontrado" : "usuarios encontrados"}
        </p>
        {filtered && (
          <Link href="/platform/users" className="font-semibold hover:text-foreground">
            Limpiar filtros
          </Link>
        )}
      </div>

      {result.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={filtered ? "No encontramos usuarios" : "Aún no hay usuarios"}
            description={
              filtered
                ? "Prueba con otro nombre, email o estado."
                : "Invita al primer usuario para comenzar a administrar sus accesos."
            }
            action={
              filtered ? (
                <Link href="/platform/users" className="primary-button">
                  Limpiar filtros
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <MotionSection className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1100px] border-collapse text-left">
              <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                <tr>
                  <th className="px-5 py-3.5">Usuario</th>
                  <th className="px-4 py-3.5">Email</th>
                  <th className="px-4 py-3.5">Estado</th>
                  <th className="px-4 py-3.5">Acceso Auth</th>
                  <th className="px-4 py-3.5">Último acceso</th>
                  <th className="px-4 py-3.5">Creado</th>
                  <th className="px-5 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.items.map((user) => (
                  <tr key={user.id} className="transition-colors hover:bg-muted/45">
                    <td className="px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <UserAvatar name={user.fullName} avatarUrl={user.avatarUrl} />
                        <div className="min-w-0">
                          <Link
                            href={`/platform/users/${user.id}`}
                            className="block max-w-56 truncate text-sm font-semibold text-foreground hover:text-brand-strong"
                          >
                            {user.fullName}
                          </Link>
                          {user.isPlatformAdmin && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-strong">
                              <ShieldCheck aria-hidden="true" className="size-3" />
                              Platform Admin
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="max-w-64 px-4 py-4 text-sm text-foreground-muted">
                      <span className="block truncate" title={user.email}>
                        {user.email}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <UserProfileStatusBadge active={user.profileActive} />
                    </td>
                    <td className="px-4 py-4">
                      <UserAuthStatusBadge status={user.authStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-foreground-muted">
                      {formatUserDate(user.lastSignInAt, true)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-foreground-muted">
                      {formatUserDate(user.createdAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/platform/users/${user.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
                        >
                          <Eye aria-hidden="true" className="size-3.5" />
                          Ver
                        </Link>
                        <UserStatusDialog
                          key={`${user.id}-${user.profileActive ? "active" : "inactive"}`}
                          userId={user.id}
                          userName={user.fullName}
                          active={user.profileActive}
                          compact
                          disabled={user.isCurrentUser && user.profileActive}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border lg:hidden">
            {result.items.map((user) => (
              <article key={user.id} className="p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <UserAvatar name={user.fullName} avatarUrl={user.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/platform/users/${user.id}`} className="block truncate text-sm font-semibold text-foreground">{user.fullName}</Link>
                    <p className="mt-1 truncate text-xs text-foreground-muted" title={user.email}>{user.email}</p>
                    {user.isPlatformAdmin && <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-strong"><ShieldCheck aria-hidden="true" className="size-3" />Platform Admin</span>}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2"><UserProfileStatusBadge active={user.profileActive} /><UserAuthStatusBadge status={user.authStatus} /></div>
                <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs"><div><dt className="text-foreground-muted">Último acceso</dt><dd className="mt-1 font-medium">{formatUserDate(user.lastSignInAt, true)}</dd></div><div><dt className="text-foreground-muted">Creado</dt><dd className="mt-1 font-medium">{formatUserDate(user.createdAt)}</dd></div></dl>
                <div className="mt-4 flex items-center justify-end gap-2"><Link href={`/platform/users/${user.id}`} className="secondary-button flex-1 gap-2 text-xs"><Eye aria-hidden="true" className="size-4" /> Ver</Link><UserStatusDialog key={`${user.id}-mobile-${user.profileActive ? "active" : "inactive"}`} userId={user.id} userName={user.fullName} active={user.profileActive} compact disabled={user.isCurrentUser && user.profileActive} /></div>
              </article>
            ))}
          </div>
        </MotionSection>
      )}

      {result.totalPages > 1 && (
        <nav
          className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between"
          aria-label="Paginación de usuarios"
        >
          <p className="text-xs text-foreground-muted">
            Página {result.page} de {result.totalPages}
          </p>
          <div className="grid w-full grid-cols-2 gap-2 min-[390px]:w-auto">
            {result.page > 1 ? (
              <Link
                href={pageHref(filters, result.page - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                Anterior
              </Link>
            ) : (
              <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted opacity-40">
                <ChevronLeft aria-hidden="true" className="size-4" />
                Anterior
              </span>
            )}
            {result.page < result.totalPages ? (
              <Link
                href={pageHref(filters, result.page + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
              >
                Siguiente
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            ) : (
              <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted opacity-40">
                Siguiente
                <ChevronRight aria-hidden="true" className="size-4" />
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
