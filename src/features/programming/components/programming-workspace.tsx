"use client";

import { CalendarDays, History, KanbanSquare, Plus, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ErrorState } from "@/components/feedback/error-state";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import type { ProjectSummary } from "@/features/projects/types";

import { loadProgrammingRange } from "../actions";
import { isActiveProgramming, isHistoricalProgramming } from "../availability";
import { formatProgrammingStatus } from "../formatters";
import {
  PROGRAMMING_EFFECTIVE_STATUSES,
  type ProgrammingEffectiveStatus,
  type ProgrammingFilters,
  type ProgrammingItem,
  type ProgrammingPageData,
  type ProgrammingRange,
} from "../types";
import { CreateProgrammingDialog } from "./create-programming-dialog";
import { ProgrammingCalendar } from "./programming-calendar";
import { ProgrammingKanban } from "./programming-kanban";
import { ProgrammingPreviewDrawer } from "./programming-preview-drawer";

type ViewMode = "calendar" | "kanban";
type ProgrammingScope = "active" | "history";

function defaultScheduledAt(timezone: string) {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:00`;
}

function ContextCreateButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "El proyecto no tiene proveedores activos" : undefined}
      className="primary-button gap-2 disabled:cursor-not-allowed"
    >
      <Plus aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
}

export function ProgrammingWorkspace({
  project,
  canCreate,
  initialData,
}: {
  project: ProjectSummary;
  canCreate: boolean;
  initialData: ProgrammingPageData;
}) {
  const [view, setView] = useState<ViewMode>("calendar");
  const [scope, setScope] = useState<ProgrammingScope>("active");
  const [availabilityNow] = useState(() => Date.now());
  const [items, setItems] = useState(initialData.items);
  const [range, setRange] = useState(initialData.range);
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<ProgrammingEffectiveStatus | "">("");
  const [selected, setSelected] = useState<ProgrammingItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dialogScheduledAt, setDialogScheduledAt] = useState(() =>
    defaultScheduledAt(project.timezone),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const filtersRef = useRef<ProgrammingFilters>({});
  const rangeRef = useRef(initialData.range);
  const itemsRef = useRef(initialData.items);
  const requestId = useRef(0);
  const skippedInitialFilters = useRef(false);
  useGlobalPending(
    pending,
    "Actualizando planificación…",
    "Consultando el rango visible del proyecto.",
  );

  const reload = useCallback(
    (nextRange: ProgrammingRange, filters = filtersRef.current) => {
      const currentRequest = ++requestId.current;
      startTransition(async () => {
        const result = await loadProgrammingRange(project.id, nextRange, filters);
        if (currentRequest !== requestId.current) return;
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        setError(null);
        setItems(result.items);
      });
    },
    [project.id],
  );

  const handleRangeChange = useCallback(
    (nextRange: ProgrammingRange) => {
      rangeRef.current = nextRange;
      setRange(nextRange);
      reload(nextRange);
    },
    [reload],
  );
  const handleSelectId = useCallback(
    (id: string) =>
      setSelected(itemsRef.current.find((item) => item.id === id) ?? null),
    [],
  );
  const handleSelectItem = useCallback((item: ProgrammingItem) => setSelected(item), []);

  useEffect(() => {
    const nextFilters: ProgrammingFilters = {
      supplierId: supplierId || undefined,
      status: status || undefined,
    };
    filtersRef.current = nextFilters;
    if (!skippedInitialFilters.current) {
      skippedInitialFilters.current = true;
      return;
    }
    reload(rangeRef.current, nextFilters);
  }, [reload, status, supplierId]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const clearFilters = () => {
    setSupplierId("");
    setStatus("");
  };
  const onCreated = useCallback(
    () => {
      setCreateOpen(false);
      setNotice("Programación creada correctamente como borrador.");
      reload(range);
    },
    [range, reload],
  );
  const openCreate = useCallback(
    (scheduledAt?: string) => {
      setDialogScheduledAt(scheduledAt ?? defaultScheduledAt(project.timezone));
      setCreateOpen(true);
    },
    [project.timezone],
  );
  const scopedItems = useMemo(() => {
    return items.filter((item) => {
      const availability = {
        status: item.status,
        scheduledAt: item.scheduledAt,
        operationStarted: item.dispatches.length > 0,
      };
      return scope === "active"
        ? isActiveProgramming(availability, availabilityNow)
        : isHistoricalProgramming(availability, availabilityNow);
    });
  }, [availabilityNow, items, scope]);

  return (
    <MotionPage className="mx-auto max-w-[1600px]">
      <MotionSection className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
            Operación · Planificación
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Programación
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            {project.name} · {project.companyName} · {project.timezone}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="inline-flex rounded-xl border border-border bg-surface p-1" role="group" aria-label="Alcance temporal">
            <button
              type="button"
              onClick={() => setScope("active")}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition sm:flex-none ${
                scope === "active" ? "bg-brand text-white" : "text-foreground-muted hover:bg-muted"
              }`}
            >
              <CalendarDays aria-hidden="true" className="size-4" /> Activas
            </button>
            <button
              type="button"
              onClick={() => setScope("history")}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition sm:flex-none ${
                scope === "history" ? "bg-sidebar text-white" : "text-foreground-muted hover:bg-muted"
              }`}
            >
              <History aria-hidden="true" className="size-4" /> Historial
            </button>
          </div>
          <div className="inline-flex rounded-xl border border-border bg-surface p-1" role="group" aria-label="Vista de programación">
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition sm:flex-none ${
                view === "calendar"
                  ? "bg-sidebar text-white shadow-sm"
                  : "text-foreground-muted hover:bg-muted hover:text-foreground"
              }`}
            >
              <CalendarDays aria-hidden="true" className="size-4" />
              Calendario
            </button>
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition sm:flex-none ${
                view === "kanban"
                  ? "bg-sidebar text-white shadow-sm"
                  : "text-foreground-muted hover:bg-muted hover:text-foreground"
              }`}
            >
              <KanbanSquare aria-hidden="true" className="size-4" />
              Kanban
            </button>
          </div>
        </div>
      </MotionSection>

      <AnimatePresence initial={false}>
        {notice && (
          <motion.div
            className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-success/20 bg-success-soft px-4 py-3 text-sm text-success"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            role="status"
          >
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar mensaje">
              <X aria-hidden="true" className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <MotionSection className="mt-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-foreground-muted">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filtros compartidos
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(13rem,1fr)_minmax(13rem,1fr)_auto]">
          <div>
            <label htmlFor="programming-filter-supplier" className="sr-only">Proveedor</label>
            <select
              id="programming-filter-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className="form-input"
            >
              <option value="">Todos los proveedores</option>
              {initialData.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.code} · {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="programming-filter-status" className="sr-only">Estado</label>
            <select
              id="programming-filter-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as ProgrammingEffectiveStatus | "")}
              className="form-input"
            >
              <option value="">Todos los estados</option>
              {PROGRAMMING_EFFECTIVE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {formatProgrammingStatus(value)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!supplierId && !status}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground-muted hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Limpiar
          </button>
        </div>
      </MotionSection>

      {error && (
        <MotionSection className="mt-4">
          <ErrorState
            title="No pudimos actualizar la planificación"
            description={error}
            onRetry={() => reload(range)}
          />
        </MotionSection>
      )}

      <MotionSection className="mt-4">
        {view === "calendar" ? (
          <div>
            <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Calendario de programación</h2>
                <p className="mt-1 text-xs text-foreground-muted">
                  También puedes seleccionar una hora en las vistas Semana o Día.
                </p>
              </div>
              {canCreate && scope === "active" && (
                <div className="sm:text-right">
                  <ContextCreateButton
                    label="Nueva programación"
                    disabled={!initialData.suppliers.length}
                    onClick={() => openCreate()}
                  />
                  {!initialData.suppliers.length && (
                    <p className="mt-2 max-w-xs text-xs text-foreground-muted">
                      Sin proveedores activos. Solicita a un administrador que
                      asigne proveedores a este proyecto.
                    </p>
                  )}
                </div>
              )}
            </div>
            <ProgrammingCalendar
              items={scopedItems}
              timezone={project.timezone}
              onRangeChange={handleRangeChange}
              onSelect={handleSelectId}
              onCreateAt={
                canCreate && scope === "active" && initialData.suppliers.length
                  ? openCreate
                  : undefined
              }
            />
          </div>
        ) : (
          <div>
            <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Kanban de programación</h2>
                <p className="mt-1 text-xs text-foreground-muted">
                  Toda programación nueva inicia en la columna Borrador.
                </p>
              </div>
              {canCreate && scope === "active" && (
                <div className="sm:text-right">
                  <ContextCreateButton
                    label="Nueva programación"
                    disabled={!initialData.suppliers.length}
                    onClick={() => openCreate()}
                  />
                  {!initialData.suppliers.length && (
                    <p className="mt-2 max-w-xs text-xs text-foreground-muted">
                      Sin proveedores activos. Solicita a un administrador que
                      asigne proveedores a este proyecto.
                    </p>
                  )}
                </div>
              )}
            </div>
            <ProgrammingKanban
              items={scopedItems}
              timezone={project.timezone}
              onSelect={handleSelectItem}
            />
          </div>
        )}
      </MotionSection>

      <ProgrammingPreviewDrawer
        item={selected}
        timezone={project.timezone}
        onClose={() => setSelected(null)}
      />
      {canCreate && (
        <CreateProgrammingDialog
          key={createOpen ? "open" : "closed"}
          open={createOpen}
          projectId={project.id}
          timezone={project.timezone}
          suppliers={initialData.suppliers}
          units={initialData.units}
          initialScheduledAt={dialogScheduledAt}
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
        />
      )}
    </MotionPage>
  );
}
