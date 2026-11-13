"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  History,
  PackageOpen,
  Pencil,
  Truck,
  XCircle,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import type { ProjectSummary } from "@/features/projects/types";
import { notifications } from "@/lib/notification-messages";
import { formatStatusLabel } from "@/lib/status-labels";

import { mutateProgrammingAction } from "../actions";
import { deliveryModeLabel, requiresServiceInvoice } from "../invoice-policy";
import {
  canEditProgramming,
  canConfirmProgramming,
  canCreateDispatchForProgramming,
  canCancelProgramming,
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
import { ProgrammingEditDialog } from "./programming-edit-dialog";
import { ProgrammingCancelDialog } from "./programming-cancel-dialog";
import { StartDispatchDialog } from "@/features/dispatches/components/register-dispatch-dialog";

type ActionIntent = Exclude<ProgrammingMutationIntent, "confirm">;
type MutationDialogIntent = Exclude<ActionIntent, "edit" | "cancel">;

const actionCopy: Record<
  MutationDialogIntent,
  { title: string; label: string; loading: string; description: string }
> = {
  close: {
    title: "Cerrar programación",
    label: "Cerrar programación",
    loading: "Cerrando programación…",
    description: "Validando despachos, guías, cantidades y las conciliaciones de Producto y Servicio requeridos antes del cierre.",
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
  PROGRAMMING_AUTO_CONFIRMED: "Confirmación automática",
  PROGRAMMING_DISPATCH_COMPLETED: "Despacho completo",
  PROGRAMMING_COMPLETED: "Programación completada",
  PROGRAMMING_BILLING_REOPENED: "Programación pendiente de conciliación",
};

const actionNotification = {
  close: notifications.statusUpdated,
} as const;

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
  onClose,
}: {
  intent: MutationDialogIntent;
  data: ProgrammingDetailPageData;
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

  useActionNotification({ pending, status: state.status, success: actionNotification[intent] });

  useEffect(() => {
    if (state.status === "success") {
      onClose();
      router.refresh();
    } else if (state.conflict) {
      router.refresh();
    }
  }, [onClose, router, state.conflict, state.status]);

  return (
    <Dialog title={copy.title} description={`PRG-${detail.id.slice(0, 8).toUpperCase()} · versión ${detail.version}`} onClose={onClose} pending={pending} size="lg">
        <form action={formAction} aria-busy={pending}>
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="projectId" value={detail.projectId} />
          <input type="hidden" name="programmingId" value={detail.id} />
          <input type="hidden" name="expectedVersion" value={detail.version} />

          <div className="grid gap-5 p-5 sm:p-6">
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

          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Volver</Button>
            <LoadingButton
              loadingLabel={copy.loading}
            >
              {copy.label}
            </LoadingButton>
          </DialogFooter>
        </form>
    </Dialog>
  );
}

function DirectConfirmButton({ detail }: { detail: ProgrammingDetailPageData["detail"] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    mutateProgrammingAction,
    initialProgrammingMutationState,
  );
  useActionNotification({ pending, status: state.status, success: notifications.programmingConfirmed });
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
      <LoadingButton loadingLabel="Confirmando…" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong sm:min-h-10 sm:w-auto">
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
  residentView = false,
}: {
  data: ProgrammingDetailPageData;
  project: ProjectSummary;
  permissions: ProgrammingDetailPermissions;
  receiverName: string;
  residentView?: boolean;
}) {
  const router = useRouter();
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [availabilityNow] = useState(() => Date.now());
  const detail = data.detail;
  const operationStarted = detail.dispatches.length > 0;
  const effectiveStatus = getEffectiveProgrammingStatus({
    version: detail.version,
    status: detail.status,
    scheduledAt: detail.scheduledAt,
    operationStarted,
    timezone: project.timezone,
  }, availabilityNow);
  const canConfirm = canConfirmProgramming({ ...detail, operationStarted, hasPermission: permissions.canConfirm }, availabilityNow);
  const canEdit = canEditProgramming({
    status: detail.status,
    scheduledAt: detail.scheduledAt,
    operationStarted,
    timezone: project.timezone,
    hasPermission: permissions.canModify,
  }, availabilityNow);
  const canRegisterDispatch = canCreateDispatchForProgramming({
    status: detail.status,
    scheduledAt: detail.scheduledAt,
    operationStarted,
    timezone: project.timezone,
    hasPermission: permissions.canCreateDispatch,
  }, availabilityNow);
  const canCancel = canCancelProgramming({ ...detail, operationStarted, hasGuides: detail.dispatches.some((dispatch) => Boolean(dispatch.guideNumber)), hasPermission: permissions.canCancel }, availabilityNow);
  const relevantRevisions = detail.revisions.filter(
    (revision) => revision.action !== "PROGRAMMING_BASELINE" && (
      !residentView || !["PROGRAMMING_COMPLETED", "PROGRAMMING_BILLING_REOPENED"].includes(revision.action)
    ),
  );
  const revisionCountLabel = `${relevantRevisions.length} ${relevantRevisions.length === 1 ? "evento" : "eventos"}`;
  const actions = useMemo(() => {
    const result: Array<{ intent: ActionIntent; label: string; icon: typeof Pencil }> = [];
    if (canEdit) {
      result.push({ intent: "edit", label: "Editar", icon: Pencil });
    }
    if (["IN_EXECUTION", "DISPATCH_COMPLETED"].includes(detail.status) && permissions.canClose) {
      result.push({ intent: "close", label: "Cerrar programación", icon: ClipboardCheck });
    }
    if (canCancel) result.push({ intent: "cancel", label: "Cancelar programación", icon: XCircle });
    return result;
  }, [canCancel, canEdit, detail.status, permissions.canClose]);

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
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${programmingStatusTone(effectiveStatus, residentView)}`}>
                {formatProgrammingStatus(effectiveStatus, residentView)}
              </span>
            </div>
            <p className="mt-2 font-mono text-xs text-foreground-muted">
              PRG-{detail.id.slice(0, 8).toUpperCase()} · versión {detail.version} · {project.name}
            </p>
          </div>
          <div className="grid w-full gap-2 min-[420px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            {actions.map((action) => {
              const Icon = action.icon;
              const destructive = action.intent === "cancel";
              return (
                <button
                  key={action.intent}
                  type="button"
                  onClick={() => setIntent(action.intent)}
                  className={destructive
                    ? "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 px-3 text-sm font-semibold text-destructive hover:bg-destructive-soft sm:min-h-10 sm:w-auto"
                    : "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground hover:bg-muted sm:min-h-10 sm:w-auto"}
                >
                  <Icon aria-hidden="true" className="size-4" /> {action.label}
                </button>
              );
            })}
            {canConfirm && (
              <DirectConfirmButton detail={detail} />
            )}
            {canRegisterDispatch && (
              <button type="button" onClick={() => setRegisterOpen(true)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong sm:min-h-10 sm:w-auto">
                <Truck aria-hidden="true" className="size-4" /> Registrar despacho
              </button>
            )}
          </div>
        </div>

        {effectiveStatus === "EXPIRED" && (
          <div role="status" className={`flex gap-3 rounded-xl border border-border p-4 text-sm ${programmingStatusTone(effectiveStatus)}`}>
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p>
              La fecha programada ({formatProgrammingDateTime(detail.scheduledAt, project.timezone)}) ya pasó. Puedes iniciar el despacho y registrar sus guías.
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
              <dl className="mt-5 grid gap-3 min-[420px]:grid-cols-2 sm:gap-5">
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Proveedor</dt><dd className="break-words text-sm text-foreground">{detail.supplierName}</dd></div>
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Fecha programada</dt><dd className="text-sm text-foreground">{formatProgrammingDateTime(detail.scheduledAt, project.timezone)}</dd></div>
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Pedido No.</dt><dd className="text-sm text-foreground">{detail.orderNumber ?? "—"}</dd></div>
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Modalidad de entrega</dt><dd className="text-sm text-foreground">{deliveryModeLabel(detail.deliveryModes)}</dd></div>
                {!residentView && <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Requisitos de cierre</dt><dd className="text-sm text-foreground">{requiresServiceInvoice(detail.deliveryModes) ? "Producto y Servicio conciliados" : "Producto conciliado; servicio opcional"}</dd></div>}
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Creada por</dt><dd className="break-words text-sm text-foreground">{detail.createdByName}</dd></div>
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Creada</dt><dd className="text-sm text-foreground">{formatProgrammingDateTime(detail.createdAt, project.timezone)}</dd></div>
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Persona que confirmó</dt><dd className="break-words text-sm text-foreground">{detail.confirmedByName ?? "Sin confirmar"}</dd></div>
                <div className="rounded-lg bg-muted/30 p-3 sm:bg-transparent sm:p-0"><dt className="form-label">Última actualización</dt><dd className="text-sm text-foreground">{formatProgrammingDateTime(detail.updatedAt, project.timezone)}</dd></div>
              </dl>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2"><PackageOpen aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Productos programados</h2></div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{detail.lines.length}</span>
              </div>
              <ol className="divide-y divide-border">
                {detail.lines.map((line) => (
                  <li key={line.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_4rem] items-center gap-3 px-5 py-4 text-sm sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(8rem,1fr)_4rem] sm:px-6">
                    <span className="font-mono text-xs text-foreground-muted">{line.position}</span>
                    <span className="font-semibold text-foreground">{formatProgrammingQuantity(line.quantity)}</span>
                    <span className="col-span-3 text-foreground-muted sm:col-span-1">{line.concreteType ?? "—"}</span>
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
                      <Link href={`/dispatches/${dispatch.id}`} className="grid grid-cols-2 gap-3 px-4 py-4 text-sm transition hover:bg-muted/35 sm:grid-cols-5 sm:px-6">
                      <div className="col-span-2 rounded-lg bg-muted/30 p-3 sm:col-span-1 sm:bg-transparent sm:p-0"><span className="form-label">Despacho</span><span className="break-all font-mono text-xs font-semibold text-brand-strong">#{dispatch.id.slice(0, 8).toUpperCase()}</span></div>
                      <div className="col-span-2 sm:col-span-1"><span className="form-label">Fecha</span><span className="font-medium text-foreground">{formatProgrammingDateTime(dispatch.createdAt, project.timezone)}</span></div>
                      <div><span className="form-label">Guía</span><span className="break-all font-medium text-foreground">{dispatch.guideNumber ?? "Pendiente"}</span></div>
                      <div><span className="form-label">Estado operativo</span><span className="font-medium text-foreground">{dispatch.status === "COMPLETED" ? "Operación finalizada" : formatStatusLabel(dispatch.status)}</span><span className="form-label mt-2">Resultado físico</span><span className="font-medium text-foreground">{formatStatusLabel(dispatch.result, "Sin resultado")}</span></div>
                      <div><span className="form-label">Cantidad</span><span className="font-medium text-foreground">{dispatch.quantity === null ? "—" : `${formatProgrammingQuantity(dispatch.quantity)} ${dispatch.unitCode}`}</span></div>
                      </Link>
                      <div className="flex justify-end px-4 pb-4 sm:px-6">
                        <Link
                          href={`/dispatches/${dispatch.id}`}
                          aria-label={`Ver despacho ${dispatch.id.slice(0, 8).toUpperCase()}`}
                          className="secondary-button w-full gap-2 sm:w-auto"
                        >
                          <Eye aria-hidden="true" className="size-4 shrink-0" />
                          Ver despacho
                        </Link>
                      </div>
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
            <ol className="max-h-[32rem] divide-y divide-border overflow-y-auto overscroll-contain xl:max-h-[70vh]">
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
                    <span>{formatProgrammingStatus(revision.status, residentView)}</span><span>·</span><span>Solicitado {formatProgrammingQuantity(revision.requestedQuantity)} {revision.unitCode}</span>
                    <span>·</span><span>{deliveryModeLabel(revision.deliveryModes)}</span>
                  </div>
                  {revision.changeReason && <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-foreground">{residentView && revision.action === "PROGRAMMING_DISPATCH_COMPLETED" ? "Terminó la operación del despacho." : revision.changeReason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <AnimatePresence>
        {intent === "edit" && (
          <ProgrammingEditDialog
            key={`edit-${detail.version}`}
            item={detail}
            suppliers={data.suppliers}
            units={data.units}
            timezone={project.timezone}
            onClose={() => setIntent(null)}
            onUpdated={() => setIntent(null)}
          />
        )}
        {intent === "cancel" && <ProgrammingCancelDialog key={`cancel-${detail.version}`} item={detail} onClose={() => setIntent(null)} onCancelled={() => { setIntent(null); router.refresh(); }} />}
        {intent === "close" && (
          <MutationDialog
            key={`${intent}-${detail.version}`}
            intent={intent}
            data={data}
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
          orderNumber: detail.orderNumber,
          concreteTypes: detail.lines.flatMap((line) => line.concreteType ? [line.concreteType] : []),
          programmedVolume: detail.confirmedQuantity ?? detail.requestedQuantity,
          unitCode: detail.unitCode,
          dispatchId: null,
          dispatchBillingComplete: false,
          dispatchStatus: null,
          result: null,
          realVolume: null,
          realUnitCode: null,
          version: null,
          guideCount: 0,
          guideTotal: 0,
          productEstimate: { amount: 0, complete: true, lineCount: 0, currency: "GTQ" },
          serviceEstimate: { amount: 0, complete: true, lineCount: 0, currency: "GTQ" },
          defaultCatalogProduct: null,
          guides: [],
        }}
        onClose={() => setRegisterOpen(false)}
      />}
    </>
  );
}
