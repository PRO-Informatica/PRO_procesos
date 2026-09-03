"use client";

import { CalendarClock, Droplets, Truck } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";

import {
  formatProgrammingDate,
  formatProgrammingQuantity,
  formatProgrammingStatus,
  formatProgrammingTime,
  programmingStatusTone,
} from "../formatters";
import {
  PROGRAMMING_EFFECTIVE_STATUSES,
  type ProgrammingEffectiveStatus,
  type ProgrammingItem,
} from "../types";

function ProgrammingCard({
  item,
  timezone,
  onSelect,
}: {
  item: ProgrammingItem;
  timezone: string;
  onSelect: (item: ProgrammingItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="w-full rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-foreground-muted">
            PRG-{item.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-foreground" title={item.supplierName}>
            {item.supplierName}
          </p>
        </div>
        {item.requiresPumping && (
          <span title="Requiere bombeo" className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <Droplets aria-hidden="true" className="size-3.5" />
          </span>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs text-foreground-muted">
        <CalendarClock aria-hidden="true" className="size-3.5 text-brand-strong" />
        <span>{formatProgrammingDate(item.scheduledAt, timezone)}</span>
        <strong className="ml-auto text-foreground">{formatProgrammingTime(item.scheduledAt, timezone)}</strong>
      </div>
      <p className="mt-3 text-lg font-semibold tracking-tight text-foreground">
        {formatProgrammingQuantity(item.requestedQuantity)} {item.unitCode}
      </p>
      {item.placementGroup && (
        <p className="mt-1 truncate text-xs text-foreground-muted" title={item.placementGroup}>
          {item.placementGroup}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${programmingStatusTone(item.effectiveStatus)}`}>
          {formatProgrammingStatus(item.effectiveStatus)}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-muted">
          <Truck aria-hidden="true" className="size-3.5" />
          {item.dispatches.length}
        </span>
      </div>
    </button>
  );
}

export function ProgrammingKanban({
  items,
  timezone,
  onSelect,
}: {
  items: ProgrammingItem[];
  timezone: string;
  onSelect: (item: ProgrammingItem) => void;
}) {
  const [mobileStatus, setMobileStatus] = useState<ProgrammingEffectiveStatus>("PENDING_CONFIRMATION");
  const grouped = Object.fromEntries(
    PROGRAMMING_EFFECTIVE_STATUSES.map((status) => [
      status,
      items.filter((item) => item.effectiveStatus === status),
    ]),
  ) as Record<ProgrammingEffectiveStatus, ProgrammingItem[]>;

  return (
    <>
      <div className="lg:hidden">
        <label htmlFor="kanban-mobile-status" className="form-label">
          Estado visible
        </label>
        <select
          id="kanban-mobile-status"
          value={mobileStatus}
          onChange={(event) => setMobileStatus(event.target.value as ProgrammingEffectiveStatus)}
          className="form-input"
        >
          {PROGRAMMING_EFFECTIVE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {formatProgrammingStatus(status)} ({grouped[status].length})
            </option>
          ))}
        </select>
        <div
          className={`subtle-scrollbar mt-4 space-y-3 ${
            grouped[mobileStatus].length > 3
              ? "max-h-[36rem] overflow-y-auto overflow-x-hidden pr-1"
              : ""
          }`}
        >
          {grouped[mobileStatus].length ? (
            grouped[mobileStatus].map((item) => (
              <ProgrammingCard key={item.id} item={item} timezone={timezone} onSelect={onSelect} />
            ))
          ) : (
            <EmptyState
              title={`Sin elementos en ${formatProgrammingStatus(mobileStatus).toLowerCase()}`}
              description="No hay programaciones con este estado dentro del rango y filtros actuales."
            />
          )}
        </div>
      </div>

      <div className="hidden overflow-x-auto pb-3 lg:block">
        <div className="grid min-w-[1440px] grid-cols-7 gap-3">
          {PROGRAMMING_EFFECTIVE_STATUSES.map((status) => (
            <section key={status} className="rounded-xl border border-border bg-muted/35 p-3">
              <div className="flex items-center justify-between gap-2 px-1 pb-3">
                <h2 className="text-xs font-semibold text-foreground">
                  {formatProgrammingStatus(status)}
                </h2>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
                  {grouped[status].length}
                </span>
              </div>
              <div
                className={`subtle-scrollbar space-y-3 ${
                  grouped[status].length > 3
                    ? "max-h-[34rem] overflow-y-auto overflow-x-hidden overscroll-contain pr-1"
                    : ""
                }`}
              >
                {grouped[status].map((item) => (
                  <ProgrammingCard key={item.id} item={item} timezone={timezone} onSelect={onSelect} />
                ))}
                {!grouped[status].length && (
                  <div className="rounded-lg border border-dashed border-border bg-surface/60 px-3 py-8 text-center text-xs text-foreground-muted">
                    Sin programaciones
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
