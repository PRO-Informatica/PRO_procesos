"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  History,
  PackageOpen,
  Pencil,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import { mutateProgrammingAction } from "../actions";
import {
  canCreateDispatchForProgramming,
  getEffectiveProgrammingStatus,
} from "../availability";
import {
  formatProgrammingDateTime,
  formatProgrammingQuantity,
  formatProgrammingStatus,
  programmingStatusTone,
} from "../formatters";
import {
  initialProgrammingMutationState,
  type ProgrammingDetailPageData,
  type ProgrammingDetailPermissions,
  type ProgrammingMutationIntent,
} from "../types";
import { ProgrammingLinesFields } from "./programming-lines-fields";
import { StartDispatchDialog } from "@/features/dispatches/components/register-dispatch-dialog";

type DialogIntent = Exclude<ProgrammingMutationIntent, "confirm">;

const actionCopy: Record<
  DialogIntent,
  { title: string; label: string; loading: string; description: string }
> = {
  edit: {
    title: "Editar programación",
    label: "Guardar cambios",
    loading: "Guardando cambios…",
    description: "Actualizando la programación y creando una revisión inmutable.",
  },
  cancel: {
    title: "Cancelar programación",
    label: "Cancelar programación",
    loading: "Cancelando programación…",
    description: "Cancelando la programación con motivo obligatorio.",
  },
  close: {
    title: "Cerrar programación",
    label: "Cerrar programación",
    loading: "Cerrando programación…",
    description: "Validando despachos, guías y cantidades antes del cierre.",
  },
};

const revisionLabels: Record<string, string> = {
  PROGRAMMING_BASELINE: "Línea base",
  PROGRAMMING_CREATED: "Programación creada",
  PROGRAMMING_UPDATED: "Programación actualizada",
  PROGRAMMING_SUBMITTED: "Enviada a confirmación",
  PROGRAMMING_RETURNED_TO_DRAFT: "Devuelta a borrador",
  PROGRAMMING_CONFIRMED: "Programación confirmada",
  PROGRAMMING_CANCELLED: "Programación cancelada",
  PROGRAMMING_IN_EXECUTION: "Ejecución iniciada",
  PROGRAMMING_COMPLETED: "Programación completada",
};

function zonedInputValue(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">
        {label}
      </p>
      <p className={`mt-2 text-xl font-semibold ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

function MutationDialog({
  intent,
  data,
  timezone,
  onClose,
}: {
  intent: DialogIntent;
  data: ProgrammingDetailPageData;
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const detail = data.detail;
  const copy = actionCopy[intent];
  const [state, formAction, pending] = useActionState(
    mutateProgrammingAction,
    initialProgrammingMutationState,
  );
  const closeNeedsReason = detail.remainingQuantity > 0 || detail.excessQuantity > 0;

  useGlobalPending(pending, copy.loading, copy.description);

  useEffect(() => {
    if (state.status === "success") {
      onClose();
      router.refresh();
    } else if (state.conflict) {
      router.refresh();
    }
  }, [onClose, router, state.conflict, state.status]);

  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="programming-action-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 id="programming-action-title" className="font-semibold text-foreground">
              {copy.title}
            </h2>
            <p className="mt-1 text-xs text-foreground-muted">
              PRG-{detail.id.slice(0, 8).toUpperCase()} · versión {detail.version}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Cerrar diálogo"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <form action={formAction} aria-busy={pending}>
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="projectId" value={detail.projectId} />
          <input type="hidden" name="programmingId" value={detail.id} />
          <input type="hidden" name="expectedVersion" value={detail.version} />

          <div className="grid gap-5 p-5 sm:p-6">
            {intent === "edit" && (
              <>
                <div>
                  <label htmlFor="detail-supplier" className="form-label">Proveedor</label>
                  <select
                    id="detail-supplier"
                    name="supplierId"
                    defaultValue={detail.supplierId}
                    required
                    className="form-input"
                    disabled={pending}
                  >
                    {data.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.code} · {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="detail-scheduled" className="form-label">Fecha y hora</label>
                  <input
                    id="detail-scheduled"
                    name="scheduledAt"
                    type="datetime-local"
                    required
                    defaultValue={zonedInputValue(detail.scheduledAt, timezone)}
                    className="form-input"
                    disabled={pending}
                  />
                  <p className="mt-1 text-xs text-foreground-muted">Zona horaria: {timezone}</p>
                </div>
                <ProgrammingLinesFields
                  units={data.units}
                  initialLines={detail.lines.map((line) => ({
                    quantity: String(line.quantity),
                    unitCode: line.unitCode,
                  }))}
                  disabled={pending}
                />
                <div>
                  <label htmlFor="detail-notes" className="form-label">Notas</label>
                  <textarea
                    id="detail-notes"
                    name="notes"
                    rows={3}
                    maxLength={1000}
                    defaultValue={detail.notes ?? ""}
                    className="form-input resize-y"
                    disabled={pending}
                  />
                </div>
              </>
            )}

            {intent === "cancel" && (
              <div>
                <label htmlFor="cancel-reason" className="form-label">Motivo de cancelación *</label>
                <textarea id="cancel-reason" name="reason" required rows={4} maxLength={1000} className="form-input resize-y" disabled={pending} />
              </div>
            )}

            {intent === "close" && (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Metric label="Objetivo" value={`${formatProgrammingQuantity(detail.confirmedQuantity ?? detail.requestedQuantity)} ${detail.unitCode}`} />
                  <Metric label="Recibido" value={`${formatProgrammingQuantity(detail.dispatchedQuantity)} ${detail.unitCode}`} />
                  <Metric label="Restante" value={`${formatProgrammingQuantity(detail.remainingQuantity)} ${detail.unitCode}`} />
                  <Metric label="Excedente" value={`${formatProgrammingQuantity(detail.excessQuantity)} ${detail.unitCode}`} />
                </div>
                <div>
                  <label htmlFor="close-reason" className="form-label">
                    Motivo del cierre {closeNeedsReason ? "*" : "(opcional)"}
                  </label>
                  <textarea id="close-reason" name="reason" required={closeNeedsReason} rows={4} maxLength={1000} className="form-input resize-y" disabled={pending} />
                </div>
              </>
            )}

            {state.status === "error" && (
              <div className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">
                <p>{state.message}</p>
                {state.conflict && <p className="mt-1 font-medium">Se recargó la versión vigente. Revisa los cambios antes de intentarlo de nuevo.</p>}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground-muted hover:bg-muted disabled:opacity-50">
              Volver
            </button>
            <LoadingButton
              loadingLabel={copy.loading}
              className={intent === "cancel" ? "inline-flex min-h-11 items-center justify-center rounded-lg bg-destructive px-4 text-sm font-semibold text-white" : "primary-button"}
            >
              {copy.label}
            </LoadingButton>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function DirectConfirmButton({ detail }: { detail: ProgrammingDetailPageData["detail"] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    mutateProgrammingAction,
    initialProgrammingMutationState,
  );
  useGlobalPending(pending, "Confirmando programación…", "Actualizando estado y trazabilidad.");
  useEffect(() => {
    if (state.status === "success" || state.conflict) router.refresh();
  }, [router, state.conflict, state.status]);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="intent" value="confirm" />
      <input type="hidden" name="projectId" value={detail.projectId} />
      <input type="hidden" name="programmingId" value={detail.id} />
      <input type="hidden" name="expectedVersion" value={detail.version} />
      <input type="hidden" name="confirmedQuantity" value={detail.requestedQuantity} />
      <LoadingButton loadingLabel="Confirmando…" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong">
        <CheckCircle2 aria-hidden="true" className="size-4" /> Confirmar
      </LoadingButton>
      {state.status === "error" && <span className="w-full text-right text-xs font-medium text-destructive">{state.message}</span>}
    </form>
  );
}

export function ProgrammingDetailView({
  data,
  project,
  permissions,
  receiverName,
}: {
  data: ProgrammingDetailPageData;
  project: ProjectSummary;
  permissions: ProgrammingDetailPermissions;
  receiverName: string;
}) {
  const [intent, setIntent] = useState<DialogIntent | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [availabilityNow] = useState(() => Date.now());
  const detail = data.detail;
  const operationStarted = detail.dispatches.length > 0;
  const effectiveStatus = getEffectiveProgrammingStatus({
    status: detail.status,
    scheduledAt: detail.scheduledAt,
    operationStarted,
  }, availabilityNow);
  const scheduleIsFuture = new Date(detail.scheduledAt).valueOf() >= availabilityNow;
  const todayKey = zonedInputValue(new Date(availabilityNow).toISOString(), project.timezone).slice(0, 10);
  const scheduledDateKey = zonedInputValue(detail.scheduledAt, project.timezone).slice(0, 10);
  const editWindowOpen = scheduledDateKey > todayKey;
  const canRegisterDispatch = canCreateDispatchForProgramming({
    status: detail.status,
    scheduledAt: detail.scheduledAt,
    operationStarted,
    hasPermission: permissions.canCreateDispatch,
  }, availabilityNow);
  const canCancel =
    permissions.canCancel &&
    effectiveStatus !== "EXPIRED" &&
    ["PENDING_CONFIRMATION", "CONFIRMED"].includes(detail.status) &&
    !(detail.status === "CONFIRMED" && detail.dispatches.length > 0);
  const relevantRevisions = detail.revisions.filter(
    (revision) => revision.action !== "PROGRAMMING_BASELINE",
  );
  const revisionCountLabel = `${relevantRevisions.length} ${relevantRevisions.length === 1 ? "evento" : "eventos"}`;
  const actions = useMemo(() => {
    const result: Array<{ intent: DialogIntent; label: string; icon: typeof Pencil }> = [];
    if (detail.status === "PENDING_CONFIRMATION" && permissions.canModify && editWindowOpen) {
      result.push({ intent: "edit", label: "Editar", icon: Pencil });
    }
    if (detail.status === "IN_EXECUTION" && permissions.canClose) {
      result.push({ intent: "close", label: "Cerrar programación", icon: ClipboardCheck });
    }
    if (canCancel) result.push({ intent: "cancel", label: "Cancelar", icon: XCircle });
    return result;
  }, [canCancel, detail.status, editWindowOpen, permissions.canClose, permissions.canModify]);

  return (
    <>
      <div className="mx-auto w-full max-w-7xl space-y-6 pb-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/programming" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground">
              <ArrowLeft aria-hidden="true" className="size-4" /> Volver a programación
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Detalle de programación</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${programmingStatusTone(effectiveStatus)}`}>
                {formatProgrammingStatus(effectiveStatus)}
              </span>
            </div>
            <p className="mt-2 font-mono text-xs text-foreground-muted">
              PRG-{detail.id.slice(0, 8).toUpperCase()} · versión {detail.version} · {project.name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {actions.map((action) => {
              const Icon = action.icon;
              const destructive = action.intent === "cancel";
              return (
                <button
                  key={action.intent}
                  type="button"
                  onClick={() => setIntent(action.intent)}
                  className={destructive
                    ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-destructive/30 px-3 text-sm font-semibold text-destructive hover:bg-destructive-soft"
                    : "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground hover:bg-muted"}
                >
                  <Icon aria-hidden="true" className="size-4" /> {action.label}
                </button>
              );
            })}
            {detail.status === "PENDING_CONFIRMATION" && permissions.canConfirm && scheduleIsFuture && (
              <DirectConfirmButton detail={detail} />
            )}
            {canRegisterDispatch && (
              <button type="button" onClick={() => setRegisterOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong">
                <Truck aria-hidden="true" className="size-4" /> Registrar despacho
              </button>
            )}
          </div>
        </div>

        {effectiveStatus === "EXPIRED" && (
          <div className="flex gap-3 rounded-xl border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p>
              Esta programación venció el {formatProgrammingDateTime(detail.scheduledAt, project.timezone)} y ya no acepta nuevos despachos.
            </p>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <CalendarClock aria-hidden="true" className="size-5 text-brand-strong" />
                <h2 className="font-semibold text-foreground">Información general</h2>
              </div>
              <dl className="mt-5 grid gap-5 sm:grid-cols-2">
                <div><dt className="form-label">Proveedor</dt><dd className="text-sm text-foreground">{detail.supplierName}</dd></div>
                <div><dt className="form-label">Fecha programada</dt><dd className="text-sm text-foreground">{formatProgrammingDateTime(detail.scheduledAt, project.timezone)}</dd></div>
                <div><dt className="form-label">Creada por</dt><dd className="text-sm text-foreground">{detail.createdByName}</dd></div>
                <div><dt className="form-label">Creada</dt><dd className="text-sm text-foreground">{formatProgrammingDateTime(detail.createdAt, project.timezone)}</dd></div>
                <div><dt className="form-label">Persona que confirmó</dt><dd className="text-sm text-foreground">{detail.confirmedByName ?? "Sin confirmar"}</dd></div>
                <div><dt className="form-label">Última actualización</dt><dd className="text-sm text-foreground">{formatProgrammingDateTime(detail.updatedAt, project.timezone)}</dd></div>
              </dl>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2"><PackageOpen aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Productos programados</h2></div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{detail.lines.length}</span>
              </div>
              <ol className="divide-y divide-border">
                {detail.lines.map((line) => (
                  <li key={line.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_4rem] items-center gap-3 px-5 py-4 text-sm sm:px-6">
                    <span className="font-mono text-xs text-foreground-muted">{line.position}</span>
                    <span className="font-semibold text-foreground">{formatProgrammingQuantity(line.quantity)}</span>
                    <span className="font-semibold text-foreground">{line.unitCode}</span>
                  </li>
                ))}
              </ol>
              <div className="flex justify-between border-t border-border bg-muted/30 px-5 py-4 text-sm font-semibold sm:px-6">
                <span className="text-foreground-muted">Total</span><span className="text-foreground">{formatProgrammingQuantity(detail.requestedQuantity)} {detail.unitCode}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
              <h2 className="font-semibold text-foreground">Notas</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground-muted">{detail.notes || "Sin notas registradas."}</p>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2"><Truck aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Despachos</h2></div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{detail.dispatches.length}</span>
              </div>
              {detail.dispatches.length ? (
                <ul className="divide-y divide-border">
                  {detail.dispatches.map((dispatch) => (
                    <li key={dispatch.id}>
                      <Link href={`/dispatches/${dispatch.id}`} className="grid gap-2 px-5 py-4 text-sm transition hover:bg-muted/35 sm:grid-cols-5 sm:px-6">
                      <div><span className="form-label">Despacho</span><span className="font-mono text-xs text-foreground">#{dispatch.id.slice(0, 8).toUpperCase()}</span></div>
                      <div><span className="form-label">Fecha</span><span className="font-medium text-foreground">{formatProgrammingDateTime(dispatch.createdAt, project.timezone)}</span></div>
                      <div><span className="form-label">Guía</span><span className="font-medium text-foreground">{dispatch.guideNumber ?? "Pendiente"}</span></div>
                      <div><span className="form-label">Estado del proceso</span><span className="font-medium text-foreground">{formatStatusLabel(dispatch.status)}</span><span className="form-label mt-2">Resultado físico</span><span className="font-medium text-foreground">{formatStatusLabel(dispatch.result, "Sin resultado")}</span></div>
                      <div><span className="form-label">Cantidad</span><span className="font-medium text-foreground">{dispatch.quantity === null ? "—" : `${formatProgrammingQuantity(dispatch.quantity)} ${dispatch.unitCode}`}</span></div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-5 py-10 text-center sm:px-6">
                  <Truck aria-hidden="true" className="mx-auto size-8 text-foreground-muted/60" />
                  <p className="mt-3 text-sm font-semibold text-foreground">Todavía no hay despachos registrados.</p>
                  <p className="mt-1 text-xs text-foreground-muted">Cuando se registre una guía, el despacho aparecerá aquí.</p>
                </div>
              )}
            </section>
          </div>

          <section className="self-start overflow-hidden rounded-2xl border border-border bg-surface xl:sticky xl:top-6">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2"><History aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Historial</h2></div>
              <span className="text-xs font-medium text-foreground-muted">{revisionCountLabel}</span>
            </div>
            <ol className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {relevantRevisions.map((revision) => (
                <li key={revision.id} className="relative px-5 py-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{revisionLabels[revision.action] ?? revision.action}</p>
                      <p className="mt-1 text-xs text-foreground-muted">{revision.actorName} · {formatProgrammingDateTime(revision.createdAt, project.timezone)}</p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-foreground-muted">v{revision.version}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-foreground-muted">
                    <span>{formatProgrammingStatus(revision.status)}</span><span>·</span><span>Solicitado {formatProgrammingQuantity(revision.requestedQuantity)} {revision.unitCode}</span>
                  </div>
                  {revision.changeReason && <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-foreground">{revision.changeReason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <AnimatePresence>
        {intent && (
          <MutationDialog
            key={`${intent}-${detail.version}`}
            intent={intent}
            data={data}
            timezone={project.timezone}
            onClose={() => setIntent(null)}
          />
        )}
      </AnimatePresence>
      {canRegisterDispatch && registerOpen && <StartDispatchDialog
        projectId={project.id}
        timezone={project.timezone || "America/Guatemala"}
        receiverName={receiverName}
        programming={{
          programmingId: detail.id,
          programmingCode: `PRG-${detail.id.slice(0, 8).toUpperCase()}`,
          programmingStatus: detail.status as "CONFIRMED" | "IN_EXECUTION",
          scheduledAt: detail.scheduledAt,
          supplierId: detail.supplierId,
          supplierName: detail.supplierName,
          programmedVolume: detail.confirmedQuantity ?? detail.requestedQuantity,
          unitCode: detail.unitCode,
          dispatchId: null,
          dispatchStatus: null,
          result: null,
          version: null,
          guideCount: 0,
          guideTotal: 0,
          guides: [],
        }}
        onClose={() => setRegisterOpen(false)}
      />}
    </>
  );
}
