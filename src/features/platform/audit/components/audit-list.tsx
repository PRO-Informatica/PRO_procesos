import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  History,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionSection } from "@/components/motion/motion-section";

import {
  formatAuditAction,
  formatAuditDate,
  formatAuditEntity,
} from "../formatters";
import type { AuditFilters, AuditListResult } from "../types";

function auditHref(filters: AuditFilters, page: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (filters.actorId) params.set("actor", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.companyId) params.set("company", filters.companyId);
  if (filters.entityType) params.set("entity", filters.entityType);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  const query = params.toString();
  return query ? `/platform/audit?${query}` : "/platform/audit";
}

function hasFilters(filters: AuditFilters) {
  return Boolean(
    filters.actorId ||
      filters.action ||
      filters.companyId ||
      filters.entityType ||
      filters.fromDate ||
      filters.toDate,
  );
}

function Scope({ company, project }: { company: string | null; project: string | null }) {
  if (!company && !project) return <span>—</span>;

  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground">{company ?? "—"}</p>
      <p className="text-xs text-foreground-muted">{project ?? "Sin proyecto"}</p>
    </div>
  );
}

export function AuditList({
  result,
  filters,
}: {
  result: AuditListResult;
  filters: AuditFilters;
}) {
  const filtered = hasFilters(filters);
  const formKey = [
    filters.actorId,
    filters.action,
    filters.companyId,
    filters.entityType,
    filters.fromDate,
    filters.toDate,
  ].join("|");

  return (
    <div className="mx-auto max-w-[1440px]">
      <MotionSection>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
          Administración global
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Auditoría
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
          Consulta cronológicamente las acciones registradas en toda la plataforma.
        </p>
      </MotionSection>

      <MotionSection className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <form key={formKey} action="/platform/audit" method="get">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Filter aria-hidden="true" className="size-4 text-brand-strong" />
            Filtros
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label>
              <span className="form-label">Actor</span>
              <select name="actor" defaultValue={filters.actorId} className="form-input h-11">
                <option value="">Todos los actores</option>
                {result.options.actors.map((actor) => (
                  <option key={actor.value} value={actor.value}>
                    {actor.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">Acción</span>
              <select name="action" defaultValue={filters.action} className="form-input h-11">
                <option value="">Todas las acciones</option>
                {result.options.actions.map((action) => (
                  <option key={action} value={action}>
                    {formatAuditAction(action)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">Empresa</span>
              <select name="company" defaultValue={filters.companyId} className="form-input h-11">
                <option value="">Todas las empresas</option>
                {result.options.companies.map((company) => (
                  <option key={company.value} value={company.value}>
                    {company.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">Entidad</span>
              <select name="entity" defaultValue={filters.entityType} className="form-input h-11">
                <option value="">Todos los tipos</option>
                {result.options.entityTypes.map((entityType) => (
                  <option key={entityType} value={entityType}>
                    {formatAuditEntity(entityType)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">Desde</span>
              <input
                type="date"
                name="from"
                defaultValue={filters.fromDate}
                className="form-input h-11"
              />
            </label>
            <label>
              <span className="form-label">Hasta</span>
              <input
                type="date"
                name="to"
                defaultValue={filters.toDate}
                className="form-input h-11"
              />
            </label>
            <div className="flex items-end gap-2 sm:col-span-2">
              <button type="submit" className="primary-button h-11 flex-1 sm:flex-none">
                Aplicar filtros
              </button>
              {filtered && (
                <Link href="/platform/audit" className="secondary-button h-11 flex-1 sm:flex-none">
                  Limpiar
                </Link>
              )}
            </div>
          </div>
        </form>
      </MotionSection>

      <div className="mt-5 flex items-center justify-between text-xs text-foreground-muted">
        <p>
          {result.total} {result.total === 1 ? "evento encontrado" : "eventos encontrados"}
        </p>
        <p className="hidden sm:block">Ordenados del más reciente al más antiguo</p>
      </div>

      {result.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={
              filtered
                ? "No se encontraron eventos con estos filtros"
                : "No hay eventos de auditoría todavía"
            }
            description={
              filtered
                ? "Prueba con otros actores, acciones, fechas o ámbitos."
                : "Los eventos aparecerán aquí cuando se registren acciones en la plataforma."
            }
            action={
              filtered ? (
                <Link href="/platform/audit" className="primary-button">
                  Limpiar filtros
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <MotionSection className="mt-4 hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left">
                <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                  <tr>
                    <th className="px-5 py-3.5">Fecha</th>
                    <th className="px-4 py-3.5">Actor</th>
                    <th className="px-4 py-3.5">Acción</th>
                    <th className="px-4 py-3.5">Empresa / Proyecto</th>
                    <th className="px-4 py-3.5">Entidad</th>
                    <th className="px-5 py-3.5">ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((event) => (
                    <tr key={event.id} className="transition-colors hover:bg-muted/40">
                      <td className="whitespace-nowrap px-5 py-4 text-xs text-foreground-muted">
                        {formatAuditDate(event.createdAt)}
                      </td>
                      <td className="max-w-52 px-4 py-4">
                        <p className="truncate text-sm font-medium text-foreground" title={event.actorName}>
                          {event.actorName}
                        </p>
                        {event.actorId && !event.actorName.startsWith("Usuario no") && (
                          <p className="mt-1 font-mono text-[10px] text-foreground-muted">
                            {event.actorId.slice(0, 8)}
                          </p>
                        )}
                      </td>
                      <td className="max-w-72 px-4 py-4">
                        <p className="text-sm font-semibold text-foreground">
                          {formatAuditAction(event.action)}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-foreground-muted">
                          {event.action}
                        </p>
                      </td>
                      <td className="max-w-64 px-4 py-4 text-sm text-foreground-muted">
                        <Scope company={event.companyName} project={event.projectName} />
                      </td>
                      <td className="px-4 py-4 text-sm text-foreground-muted">
                        {formatAuditEntity(event.entityType)}
                      </td>
                      <td className="max-w-48 px-5 py-4 font-mono text-[11px] text-foreground-muted">
                        <span className="block truncate" title={event.entityId ?? "Sin identificador"}>
                          {event.entityId ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </MotionSection>

          <MotionSection className="mt-4 space-y-3 md:hidden">
            {result.items.map((event) => (
              <article key={event.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {formatAuditAction(event.action)}
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] text-foreground-muted">
                      {event.action}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-foreground-muted">
                    {formatAuditEntity(event.entityType)}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-xs">
                  <div className="flex items-center gap-2">
                    <Clock3 aria-hidden="true" className="size-4 shrink-0 text-brand-strong" />
                    <dt className="sr-only">Fecha</dt>
                    <dd className="text-foreground-muted">{formatAuditDate(event.createdAt)}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <UserRound aria-hidden="true" className="size-4 shrink-0 text-brand-strong" />
                    <dt className="sr-only">Actor</dt>
                    <dd className="truncate font-medium text-foreground">{event.actorName}</dd>
                  </div>
                  <div className="flex items-start gap-2">
                    <History aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-strong" />
                    <dt className="sr-only">Ámbito</dt>
                    <dd className="min-w-0 text-foreground-muted">
                      <Scope company={event.companyName} project={event.projectName} />
                    </dd>
                  </div>
                  <div className="flex items-start gap-2">
                    <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-strong" />
                    <dt className="sr-only">ID de entidad</dt>
                    <dd className="min-w-0 break-all font-mono text-[10px] text-foreground-muted">
                      {event.entityId ?? "—"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </MotionSection>
        </>
      )}

      {result.totalPages > 1 && (
        <nav
          className="mt-5 flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
          aria-label="Paginación de auditoría"
        >
          <p className="text-xs text-foreground-muted">
            Página {result.page} de {result.totalPages}
          </p>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link
                href={auditHref(filters, result.page - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                Anterior
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link
                href={auditHref(filters, result.page + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
              >
                Siguiente
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </div>
        </nav>
      )}
    </div>
  );
}
