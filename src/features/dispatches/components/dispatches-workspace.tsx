"use client";

import {
  AlertCircle,
  CalendarClock,
  ChevronRight,
  CircleSlash2,
  ClipboardList,
  PackageCheck,
  Plus,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import type { ProjectSummary } from "@/features/projects/types";

import {
  formatDispatchDate,
  formatDispatchDateTime,
  formatDispatchQuantity,
  formatDispatchResult,
  formatDispatchStatus,
  formatIdentifier,
} from "../formatters";
import {
  DISPATCH_RESULTS,
  DISPATCH_STATUSES,
  type DispatchPageData,
  type DispatchResult,
  type DispatchStatus,
} from "../types";
import { DispatchResultBadge, DispatchStatusBadge } from "./dispatch-badges";

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Truck;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
          {label}
        </p>
        <Icon aria-hidden="true" className="size-4 text-brand-strong" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DisabledRegisterButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      disabled
      title="Disponible en la fase de registro de guía"
      className={`${compact ? "min-h-10 px-3" : "min-h-11 px-4"} inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-white opacity-55`}
    >
      <Plus aria-hidden="true" className="size-4" />
      Registrar despacho
    </button>
  );
}

export function DispatchesWorkspace({
  project,
  canCreate,
  data,
}: {
  project: ProjectSummary;
  canCreate: boolean;
  data: DispatchPageData;
}) {
  const [status, setStatus] = useState<DispatchStatus | "">("");
  const [result, setResult] = useState<DispatchResult | "NONE" | "">("");
  const [supplierId, setSupplierId] = useState("");
  const [programmingId, setProgrammingId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(
    () =>
      data.items.filter((item) => {
        const dispatchDate = item.guideDate ?? item.createdAt.slice(0, 10);
        return (
          (!status || item.status === status) &&
          (!result || (result === "NONE" ? item.result === null : item.result === result)) &&
          (!supplierId || item.supplierId === supplierId) &&
          (!programmingId || item.programmingId === programmingId) &&
          (!dateFrom || dispatchDate >= dateFrom) &&
          (!dateTo || dispatchDate <= dateTo)
        );
      }),
    [data.items, dateFrom, dateTo, programmingId, result, status, supplierId],
  );
  const hasFilters = Boolean(status || result || supplierId || programmingId || dateFrom || dateTo);
  const programmingOptions = [...new Map(
    data.items.map((item) => [item.programmingId, item.programmingCode]),
  ).entries()];
  const metrics = {
    total: data.items.length,
    registered: data.items.filter((item) => item.status === "REGISTERED").length,
    batched: data.items.filter((item) => item.status === "BATCHED").length,
    incidents: data.items.filter((item) => item.incidentCount > 0).length,
    withoutResult: data.items.filter((item) => item.result === null).length,
  };

  const clearFilters = () => {
    setStatus("");
    setResult("");
    setSupplierId("");
    setProgrammingId("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <MotionPage className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <MotionSection className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
            Operación · Recepción
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Despachos
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Seguimiento read-only de despachos, guías y recepción en {project.name}.
          </p>
        </div>
        {canCreate && <DisabledRegisterButton />}
      </MotionSection>

      {canCreate && (
        <p className="-mt-2 text-xs text-foreground-muted sm:text-right">
          El registro estará disponible en la fase de registro de guía.
        </p>
      )}

      <MotionSection className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Total despachos" value={metrics.total} icon={Truck} />
        <Metric label="Registrados" value={metrics.registered} icon={ClipboardList} />
        <Metric label="En lote" value={metrics.batched} icon={PackageCheck} />
        <Metric label="Con incidencias" value={metrics.incidents} icon={AlertCircle} />
        <Metric label="Sin resultado" value={metrics.withoutResult} icon={CircleSlash2} />
      </MotionSection>

      <MotionSection className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-foreground-muted">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filtros
          </div>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-strong hover:text-brand">
              <X aria-hidden="true" className="size-3.5" /> Limpiar
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div>
            <label htmlFor="dispatch-status" className="sr-only">Estado del proceso</label>
            <select id="dispatch-status" value={status} onChange={(event) => setStatus(event.target.value as DispatchStatus | "")} className="form-input">
              <option value="">Todos los estados</option>
              {DISPATCH_STATUSES.map((value) => <option key={value} value={value}>{formatDispatchStatus(value)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dispatch-result" className="sr-only">Resultado físico</label>
            <select id="dispatch-result" value={result} onChange={(event) => setResult(event.target.value as DispatchResult | "NONE" | "")} className="form-input">
              <option value="">Todos los resultados</option>
              <option value="NONE">Sin resultado</option>
              {DISPATCH_RESULTS.map((value) => <option key={value} value={value}>{formatDispatchResult(value)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dispatch-supplier" className="sr-only">Proveedor</label>
            <select id="dispatch-supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="form-input">
              <option value="">Todos los proveedores</option>
              {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dispatch-programming" className="sr-only">Programación</label>
            <select id="dispatch-programming" value={programmingId} onChange={(event) => setProgrammingId(event.target.value)} className="form-input">
              <option value="">Todas las programaciones</option>
              {programmingOptions.map(([id, code]) => <option key={id} value={id}>{code}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="dispatch-date-from" className="sr-only">Fecha desde</label>
              <input id="dispatch-date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="form-input" title="Fecha desde" />
            </div>
            <div>
              <label htmlFor="dispatch-date-to" className="sr-only">Fecha hasta</label>
              <input id="dispatch-date-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="form-input" title="Fecha hasta" />
            </div>
          </div>
        </div>
      </MotionSection>

      <MotionSection>
        {data.items.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={data.eligibleProgramming.length ? "Aún no hay despachos registrados" : "No hay despachos disponibles"}
            description={data.eligibleProgramming.length
              ? "Hay programaciones confirmadas listas para despacho. El registro estará disponible en la fase de guía."
              : "Primero debes confirmar una programación para iniciar el flujo de despacho."}
            action={canCreate && data.eligibleProgramming.length ? <DisabledRegisterButton compact /> : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SlidersHorizontal}
            title="No hay resultados para estos filtros"
            description="Ajusta los criterios o restablece la vista completa."
            action={<button type="button" onClick={clearFilters} className="primary-button">Limpiar filtros</button>}
          />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border border-border bg-surface lg:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                  <thead className="bg-muted/70 text-[10px] uppercase tracking-[0.08em] text-foreground-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Fecha de guía</th>
                      <th className="px-4 py-3 font-semibold">Guía</th>
                      <th className="px-4 py-3 font-semibold">Programación</th>
                      <th className="px-4 py-3 font-semibold">Proveedor</th>
                      <th className="px-4 py-3 font-semibold">Cantidad</th>
                      <th className="px-4 py-3 font-semibold">Receptor</th>
                      <th className="px-4 py-3 font-semibold">Estado del proceso</th>
                      <th className="px-4 py-3 font-semibold">Resultado físico</th>
                      <th className="px-4 py-3"><span className="sr-only">Abrir</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((item) => (
                      <tr key={item.id} className="group hover:bg-muted/35">
                        <td className="px-4 py-4 text-foreground-muted">{formatDispatchDate(item.guideDate)}</td>
                        <td className="px-4 py-4 font-semibold text-foreground">{item.guideNumber ?? "Sin guía"}</td>
                        <td className="px-4 py-4"><Link href={`/programming/${item.programmingId}`} className="font-mono text-xs font-semibold text-brand-strong hover:underline">{item.programmingCode}</Link></td>
                        <td className="px-4 py-4 font-medium text-foreground">{item.supplierName}</td>
                        <td className="px-4 py-4 font-semibold text-foreground">{item.quantity === null ? "—" : `${formatDispatchQuantity(item.quantity)} ${item.unitCode}`}</td>
                        <td className="px-4 py-4 text-foreground-muted">{item.receivedByName ?? "No registrado"}</td>
                        <td className="px-4 py-4"><DispatchStatusBadge status={item.status} /></td>
                        <td className="px-4 py-4"><DispatchResultBadge result={item.result} /></td>
                        <td className="px-4 py-4 text-right"><Link href={`/dispatches/${item.id}`} aria-label={`Abrir ${formatIdentifier("DSP", item.id)}`} className="inline-grid size-9 place-items-center rounded-lg text-foreground-muted group-hover:bg-surface group-hover:text-foreground"><ChevronRight aria-hidden="true" className="size-4" /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 lg:hidden">
              {filtered.map((item) => (
                <Link key={item.id} href={`/dispatches/${item.id}`} className="rounded-xl border border-border bg-surface p-4 transition hover:border-brand/35 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{item.guideNumber ?? "Sin guía"}</p>
                      <p className="mt-1 truncate text-sm text-foreground-muted">{item.supplierName}</p>
                    </div>
                    <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-foreground-muted" />
                  </div>
                  <p className="mt-4 text-xl font-semibold text-foreground">{item.quantity === null ? "—" : `${formatDispatchQuantity(item.quantity)} ${item.unitCode}`}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-foreground-muted">Programación</p><p className="mt-1 font-mono font-semibold text-foreground">{item.programmingCode}</p></div>
                    <div><p className="text-foreground-muted">Fecha</p><p className="mt-1 font-semibold text-foreground">{formatDispatchDate(item.guideDate)}</p></div>
                    <div><p className="mb-1 text-foreground-muted">Estado</p><DispatchStatusBadge status={item.status} /></div>
                    <div><p className="mb-1 text-foreground-muted">Resultado</p><DispatchResultBadge result={item.result} /></div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </MotionSection>

      {data.eligibleProgramming.length > 0 && (
        <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="font-semibold text-foreground">Listas para despacho</h2>
              <p className="mt-1 text-xs text-foreground-muted">Programaciones confirmadas o actualmente en ejecución.</p>
            </div>
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">{data.eligibleProgramming.length}</span>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {data.eligibleProgramming.map((item) => (
              <Link key={item.id} href={`/programming/${item.id}`} className="rounded-xl border border-border p-4 hover:bg-muted/35">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-mono text-xs font-semibold text-brand-strong">{formatIdentifier("PRG", item.id)}</p><p className="mt-1 font-semibold text-foreground">{item.supplierName}</p></div>
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground-muted">{item.status === "CONFIRMED" ? "Confirmada" : "En ejecución"}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-foreground-muted">Objetivo</p><p className="mt-1 font-semibold text-foreground">{formatDispatchQuantity(item.confirmedQuantity ?? item.requestedQuantity)} {item.unitCode}</p></div>
                  <div><p className="text-foreground-muted">Restante</p><p className="mt-1 font-semibold text-foreground">{formatDispatchQuantity(item.remaining)} {item.unitCode}</p></div>
                  <div><p className="text-foreground-muted">Productos</p><p className="mt-1 font-semibold text-foreground">{item.lineCount}</p></div>
                  <div><p className="text-foreground-muted">Despachos</p><p className="mt-1 font-semibold text-foreground">{item.dispatchCount}</p></div>
                </div>
                <p className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-foreground-muted"><CalendarClock aria-hidden="true" className="size-3.5" /> {formatDispatchDateTime(item.scheduledAt, project.timezone)}</p>
              </Link>
            ))}
          </div>
        </MotionSection>
      )}
    </MotionPage>
  );
}
