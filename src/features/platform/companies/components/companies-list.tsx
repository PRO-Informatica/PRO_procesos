import { ChevronLeft, ChevronRight, Eye, Plus, Search } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionSection } from "@/components/motion/motion-section";

import { formatDate } from "../formatters";
import type { CompanyListFilters, CompanyListResult } from "../types";
import { CompanyStatusBadge } from "./company-status-badge";
import { CompanyStatusDialog } from "./company-status-dialog";

function pageHref(filters: CompanyListFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/platform/companies?${query}` : "/platform/companies";
}

export function CompaniesList({
  result,
  filters,
}: {
  result: CompanyListResult;
  filters: CompanyListFilters;
}) {
  const filtered = Boolean(filters.query || filters.status !== "ALL");
  const currentUrl = pageHref(filters, result.page);

  return (
    <div className="mx-auto max-w-[1440px]">
      <MotionSection className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
            Administración global
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Empresas
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Consulta y administra las empresas registradas en la plataforma.
          </p>
        </div>
        <Link
          href="/platform/companies/new"
          className="primary-button w-full shrink-0 gap-2 sm:w-auto"
        >
          <Plus aria-hidden="true" className="size-4" />
          Nueva empresa
        </Link>
      </MotionSection>

      <MotionSection className="mt-6">
        <form
          action="/platform/companies"
          method="get"
          className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_13rem_auto]"
        >
        <label className="relative block">
          <span className="sr-only">Buscar empresas</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted"
          />
          <input
            type="search"
            name="q"
            defaultValue={filters.query}
            maxLength={80}
            placeholder="Buscar por nombre o código"
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
            <option value="ACTIVE">Activas</option>
            <option value="INACTIVE">Inactivas</option>
          </select>
        </label>
        <button type="submit" className="primary-button h-11">
          Aplicar filtros
        </button>
        </form>
      </MotionSection>

      <div className="mt-4 flex items-center justify-between text-xs text-foreground-muted">
        <p>
          {result.total} {result.total === 1 ? "empresa encontrada" : "empresas encontradas"}
        </p>
        {filtered && (
          <Link href="/platform/companies" className="font-semibold hover:text-foreground">
            Limpiar filtros
          </Link>
        )}
      </div>

      {result.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={filtered ? "No encontramos empresas" : "Aún no hay empresas"}
            description={
              filtered
                ? "Prueba con otro nombre, código o estado."
                : "Crea la primera empresa para comenzar a administrar la plataforma."
            }
            action={
              filtered ? (
                <Link href="/platform/companies" className="primary-button">
                  Limpiar filtros
                </Link>
              ) : (
                <Link href="/platform/companies/new" className="primary-button">
                  Crear empresa
                </Link>
              )
            }
          />
        </div>
      ) : (
        <MotionSection className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                <tr>
                  <th className="px-5 py-3.5">Empresa</th>
                  <th className="px-4 py-3.5">Código</th>
                  <th className="px-4 py-3.5">Estado</th>
                  <th className="px-4 py-3.5 text-center">Proyectos</th>
                  <th className="px-4 py-3.5 text-center">Usuarios</th>
                  <th className="px-4 py-3.5">Company Admin</th>
                  <th className="px-4 py-3.5">Creada</th>
                  <th className="px-5 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.items.map((company) => (
                  <tr key={company.id} className="transition-colors hover:bg-muted/45">
                    <td className="px-5 py-4">
                      <Link
                        href={`/platform/companies/${company.id}`}
                        className="font-semibold text-foreground hover:text-brand-strong"
                      >
                        {company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-foreground-muted">
                      {company.code}
                    </td>
                    <td className="px-4 py-4">
                      <CompanyStatusBadge status={company.status} />
                    </td>
                    <td className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                      {company.projectCount}
                    </td>
                    <td className="px-4 py-4 text-center text-sm font-semibold text-foreground">
                      {company.activeUserCount}
                    </td>
                    <td className="max-w-60 px-4 py-4 text-sm text-foreground-muted">
                      <span
                        className="block truncate"
                        title={company.companyAdmins.join(", ") || "Sin administrador"}
                      >
                        {company.companyAdmins.join(", ") || "Sin administrador"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-foreground-muted">
                      {formatDate(company.createdAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/platform/companies/${company.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
                        >
                          <Eye aria-hidden="true" className="size-3.5" />
                          Ver
                        </Link>
                        <CompanyStatusDialog
                          companyId={company.id}
                          companyName={company.name}
                          status={company.status}
                          returnTo={currentUrl}
                          compact
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border lg:hidden">
            {result.items.map((company) => (
              <article key={company.id} className="p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/platform/companies/${company.id}`} className="block truncate font-semibold text-foreground">
                      {company.name}
                    </Link>
                    <p className="mt-1 font-mono text-xs text-foreground-muted">{company.code}</p>
                  </div>
                  <CompanyStatusBadge status={company.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs">
                  <div><dt className="text-foreground-muted">Proyectos</dt><dd className="mt-1 font-semibold">{company.projectCount}</dd></div>
                  <div><dt className="text-foreground-muted">Usuarios</dt><dd className="mt-1 font-semibold">{company.activeUserCount}</dd></div>
                  <div className="col-span-2 min-w-0"><dt className="text-foreground-muted">Company Admin</dt><dd className="mt-1 truncate font-medium" title={company.companyAdmins.join(", ") || "Sin administrador"}>{company.companyAdmins.join(", ") || "Sin administrador"}</dd></div>
                  <div className="col-span-2"><dt className="text-foreground-muted">Creada</dt><dd className="mt-1 font-medium">{formatDate(company.createdAt)}</dd></div>
                </dl>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Link href={`/platform/companies/${company.id}`} className="secondary-button flex-1 gap-2 text-xs"><Eye aria-hidden="true" className="size-4" /> Ver</Link>
                  <CompanyStatusDialog companyId={company.id} companyName={company.name} status={company.status} returnTo={currentUrl} compact />
                </div>
              </article>
            ))}
          </div>
        </MotionSection>
      )}

      {result.totalPages > 1 && (
        <nav
          className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between"
          aria-label="Paginación de empresas"
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
