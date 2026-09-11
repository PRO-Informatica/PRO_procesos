"use client";

import { ArrowLeft, ChevronDown, FileSearch, Files, History, LoaderCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import { StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import type { ProjectSummary } from "@/features/projects/types";
import { switchProject } from "@/features/projects/actions";
import { useProjectContext } from "@/features/projects/project-context";
import { notifications } from "@/lib/notification-messages";
import { notify } from "@/lib/notify";
import { formatStatusLabel } from "@/lib/status-labels";

import { decideInvoiceRecipientExceptionAction, reconcileDispatchAction, requestDispatchReinvoicingAction } from "../actions";
import { formatBatchDate, formatBatchDateTime, formatBatchQuantity } from "../formatters";
import { initialBatchMutationState, type BatchDetail, type BatchDispatchRelation, type BatchInvoice, type BatchPermissions, type BatchSecondaryData, type InvoiceType, type ReconciliationStatus } from "../types";
import { AddDispatchDialog, Modal, RemoveDispatchDialog, RolloverDialog } from "./batch-dialogs";
import { BatchStatusBadge } from "./batch-status-badge";
import { BulkInvoiceDialog, DispatchInvoiceDialog } from "./invoice-dialogs";

type InvoiceSelection = { relation: BatchDispatchRelation; type: InvoiceType; replacement?: boolean };
const initialSwitchProjectState = { status: "idle" as const };

function DispatchDetailLink({
  dispatchId,
  projectId,
  className,
  children,
}: {
  dispatchId: string;
  projectId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const context = useProjectContext();
  const [state, action, pending] = useActionState(switchProject, initialSwitchProjectState);
  const href = `/dispatches/${dispatchId}`;
  const needsProjectSwitch = context.activeProject?.id !== projectId;
  useGlobalPending(
    pending,
    "Abriendo despacho…",
    "Estamos cambiando al proyecto correspondiente.",
  );

  if (!needsProjectSwitch) {
    return <Link href={href} className={className}>{children}</Link>;
  }

  return (
    <form action={action} className="contents">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={href} />
      <button type="submit" className={className} disabled={pending}>
        {children}
      </button>
      {state.status === "error" && (
        <span className="sr-only" role="alert">{state.message}</span>
      )}
    </form>
  );
}

function InvoiceCell({ relation, type }: { relation: BatchDispatchRelation; type: InvoiceType }) {
  const invoice = type === "PRODUCT" ? relation.productInvoice : relation.serviceInvoice;
  return invoice ? <div className="min-w-0"><p className="break-all font-semibold">{invoice.number}</p><p className="text-xs text-foreground-muted">{formatBatchDate(invoice.date)}</p>{invoice.recipientException?.status === "PENDING" && <span className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200">Decisión C14 pendiente</span>}{type === "PRODUCT" && invoice.replacesInvoiceId && <Link href="/invoices" className="mt-1 inline-flex text-xs font-semibold text-brand-strong hover:underline">Ver factura anterior</Link>}</div> : <span className="text-foreground-muted">Pendiente</span>;
}

function RecipientExceptionButtons({ relation, onSelect, mobile = false }: { relation: BatchDispatchRelation; onSelect: (invoice: BatchInvoice) => void; mobile?: boolean }) {
  const pendingInvoices = [relation.productInvoice, relation.serviceInvoice].filter(
    (invoice): invoice is BatchInvoice => invoice?.recipientException?.status === "PENDING",
  );
  return pendingInvoices.map((invoice) => (
    <button key={invoice.id} type="button" onClick={() => onSelect(invoice)} className={`secondary-button text-xs ${mobile ? "w-full" : ""}`}>
      Revisar C14 · {invoice.type === "PRODUCT" ? "Producto" : "Servicio"}
    </button>
  ));
}

function RecipientExceptionDialog({ projectId, batchId, invoice, onClose, onSuccess }: { projectId: string; batchId: string; invoice: BatchInvoice; onClose: () => void; onSuccess: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "APPROVE" | "REQUEST_REINVOICE") {
    startTransition(async () => {
      const result = await decideInvoiceRecipientExceptionAction(projectId, batchId, invoice.id, decision);
      if (result.status === "error") {
        setMessage(result.message);
        notify.error(notifications.actionFailed);
        return;
      }
      notify.success(decision === "APPROVE" ? "Excepción aceptada" : notifications.reinvoicingRequested);
      await onSuccess();
      onClose();
    });
  }

  return (
    <Modal title="Decisión de facturación C14" description={`Factura de ${invoice.type === "PRODUCT" ? "Producto" : "Servicio"} ${invoice.number}.`} icon={FileSearch} onClose={onClose} pending={pending}>
      <div className="space-y-3 p-5 text-sm sm:p-6">
        <p>Esta factura coincide con el proyecto, pedido y proveedor. Decide si se acepta excepcionalmente a C14 o si debe refacturarse.</p>
        <div className="rounded-xl bg-warning-soft p-3 text-warning">
          <p className="font-semibold">Receptor detectado</p>
          <p className="mt-1 break-words text-xs">{invoice.recipientException?.detectedBillingLegalName ?? "CONSTRUCTORA CATORCE"}</p>
        </div>
        {message && <p role="alert" className="rounded-xl bg-destructive-soft p-3 text-destructive">{message}</p>}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
        <LoadingButton type="button" variant="secondary" loading={pending} onClick={() => decide("REQUEST_REINVOICE")} loadingLabel="Registrando…">Solicitar refacturación</LoadingButton>
        <LoadingButton type="button" loading={pending} onClick={() => decide("APPROVE")} loadingLabel="Aceptando…">Aceptar excepción</LoadingButton>
      </DialogFooter>
    </Modal>
  );
}

function reconciliationTone(status: ReconciliationStatus): BadgeTone {
  if (status === "RECONCILED") return "success";
  if (["WITH_DIFFERENCES", "PENDING_REINVOICING"].includes(status)) return "warning";
  return "neutral";
}

function ReinvoicingDialog({ projectId, batchId, relation, onClose, onSuccess }: { projectId: string; batchId: string; relation: BatchDispatchRelation; onClose: () => void; onSuccess?: () => void | Promise<void> }) {
  const router = useRouter();
  const successHandled = useRef(false);
  const [state, action, pending] = useActionState(requestDispatchReinvoicingAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.reinvoicingRequested });
  useEffect(() => {
    if (state.status === "success" && !successHandled.current) {
      successHandled.current = true;
      void (async () => {
        try { if (onSuccess) await onSuccess(); else router.refresh(); }
        finally { onClose(); }
      })();
    }
  }, [onClose, onSuccess, router, state.status]);

  return (
    <Modal title="Solicitar refacturación" description="La factura original se conservará y la siguiente será una nueva Factura de Producto vinculada." icon={FileSearch} onClose={onClose} pending={pending}>
      <form action={action}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="dispatchId" value={relation.dispatchId} />
        <div className="p-5 sm:p-6">
          <label className="form-label" htmlFor="reinvoicing-reason">Motivo *</label>
          <textarea id="reinvoicing-reason" name="reason" required maxLength={1000} rows={4} className="form-input" />
          {state.status === "error" && <p role="alert" className="mt-3 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
          <LoadingButton loadingLabel="Solicitando…">Solicitar</LoadingButton>
        </DialogFooter>
      </form>
    </Modal>
  );
}

export function BatchDetailView({ detail, project, permissions, embedded = false, loadSecondary, onDataChanged }: { detail: BatchDetail; project: ProjectSummary; permissions: BatchPermissions; embedded?: boolean; loadSecondary?: () => Promise<BatchSecondaryData>; onDataChanged?: () => void | Promise<void> }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [remove, setRemove] = useState<BatchDispatchRelation | null>(null);
  const [invoice, setInvoice] = useState<InvoiceSelection | null>(null);
  const [reinvoicing, setReinvoicing] = useState<BatchDispatchRelation | null>(null);
  const [recipientExceptionInvoice, setRecipientExceptionInvoice] = useState<BatchInvoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(!embedded);
  const [secondaryPending, setSecondaryPending] = useState(false);
  const [secondaryData, setSecondaryData] = useState<BatchSecondaryData | null>(detail.secondaryLoaded ? { removedRelations: detail.removedRelations, preview: detail.preview, loadMetrics: detail.loadMetrics } : null);
  const [pending, startTransition] = useTransition();
  const editable = detail.status === "OPEN";
  const resolvedSecondary = loadSecondary ? secondaryData : { removedRelations: detail.removedRelations, preview: detail.preview, loadMetrics: detail.loadMetrics };

  async function refreshData() {
    setSecondaryData(null);
    if (embedded) setHistoryOpen(false);
    if (onDataChanged) await onDataChanged();
    else router.refresh();
  }

  async function ensureSecondary() {
    if (secondaryData) return secondaryData;
    if (!loadSecondary) return { removedRelations: detail.removedRelations, preview: detail.preview, loadMetrics: detail.loadMetrics };
    setSecondaryPending(true);
    try {
      const data = await loadSecondary();
      setSecondaryData(data);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "No fue posible cargar los datos secundarios.";
      setMessage(errorMessage);
      notify.error(notifications.actionFailed);
      return null;
    } finally {
      setSecondaryPending(false);
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    const data = await ensureSecondary();
    if (data) setHistoryOpen(true);
  }

  async function openRollover() {
    const data = await ensureSecondary();
    if (data) setRolloverOpen(true);
  }

  function reconcile(relation: BatchDispatchRelation) {
    startTransition(async () => {
      const result = await reconcileDispatchAction(project.id, detail.id, relation.dispatchId);
      if (result.status === "success") {
        setMessage(null);
        if (result.reconciliationStatus === "RECONCILED") notify.success(notifications.reconciliationCompleted);
        else notify.warning(notifications.reconciliationDifferences);
        await refreshData();
      } else {
        setMessage(result.message);
        notify.error(notifications.actionFailed);
      }
    });
  }

  return <MotionPage disableMotion={embedded} className={embedded ? "space-y-5" : "mx-auto max-w-[1600px] space-y-5 pb-10"}>
    <MotionSection disableMotion={embedded}>
      {!embedded && <Link href="/batches" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"><ArrowLeft className="size-4" /> Volver a lotes</Link>}
      <div className={`${embedded ? "" : "mt-4"} flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between`}>
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">{embedded ? `${project.name} · ${project.code}` : "Lote semanal"}</p><div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold sm:text-3xl">{detail.code}</h1><BatchStatusBadge status={detail.status} /></div><p className="mt-2 text-sm text-foreground-muted">{formatBatchDate(detail.periodStart)} – {formatBatchDate(detail.periodEnd)} · Período contable {formatBatchDate(detail.accountingPeriod)}</p></div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          {permissions.canModify && editable && <button type="button" onClick={() => setAddOpen(true)} className="secondary-button w-full gap-2 sm:w-auto"><Plus className="size-4" /> Agregar despacho</button>}
          {permissions.canCreateInvoice && editable && <button type="button" onClick={() => setBulkOpen(true)} className="secondary-button w-full gap-2 sm:w-auto"><Files className="size-4" /> Carga masiva de facturas</button>}
          {permissions.canModify && editable && <button type="button" onClick={() => void openRollover()} disabled={secondaryPending} className="primary-button w-full gap-2 sm:w-auto disabled:opacity-60">{secondaryPending ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Cerrar semana y preparar siguiente</button>}
        </div>
      </div>
      {message && <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm">{message}</p>}
    </MotionSection>

    <MotionSection disableMotion={embedded} className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3.5 sm:px-5 sm:py-4"><h2 className="font-semibold">Despachos del lote</h2><p className="mt-1 text-xs leading-5 text-foreground-muted">Las guías son detalle interno; la pertenencia al lote y la conciliación pertenecen al despacho.</p></div>
      {detail.activeRelations.length ? <><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-foreground-muted"><tr><th className="p-4">Despacho</th><th className="p-4">Pedido</th><th className="p-4">Proveedor</th><th className="p-4">Volumen Real</th><th className="p-4">Factura Producto</th><th className="p-4">Factura Servicio</th><th className="p-4">Estado</th><th className="p-4 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">
        {detail.activeRelations.map((relation) => <tr key={relation.relationId} className="align-top"><td className="p-4"><DispatchDetailLink dispatchId={relation.dispatchId} projectId={project.id} className="font-semibold text-brand-strong hover:underline disabled:cursor-wait disabled:opacity-60">{relation.programmingCode}</DispatchDetailLink><p className="mt-1 text-xs text-foreground-muted">{relation.operationalStatus === "COMPLETED" ? "Completado" : "En ejecución"} · {relation.guideCount} guía(s)</p></td><td className="p-4 font-semibold">{relation.orderNumber ?? "Pendiente"}</td><td className="p-4">{relation.supplierName}</td><td className="p-4 font-semibold">{relation.realVolume === null ? "Pendiente" : `${formatBatchQuantity(relation.realVolume)} ${relation.realUnitCode ?? ""}`}</td><td className="p-4"><InvoiceCell relation={relation} type="PRODUCT" /></td><td className="p-4"><InvoiceCell relation={relation} type="SERVICE" /></td><td className="p-4"><StatusBadge label={relation.operationalStatus === "IN_EXECUTION" ? "Despacho en ejecución" : formatStatusLabel(relation.reconciliationStatus)} tone={relation.operationalStatus === "IN_EXECUTION" ? "info" : reconciliationTone(relation.reconciliationStatus)} />{relation.latestAttempt && <p className="mt-2 text-xs text-foreground-muted">Intento {relation.latestAttempt.attemptNumber}: diferencia {relation.latestAttempt.difference === null ? "no comparable" : formatBatchQuantity(relation.latestAttempt.difference)}</p>}</td><td className="p-4"><div className="flex flex-wrap justify-end gap-2"><DispatchDetailLink dispatchId={relation.dispatchId} projectId={project.id} className="secondary-button text-xs disabled:cursor-wait disabled:opacity-60">Ver despacho</DispatchDetailLink>
          {editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.productInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT" })} className="secondary-button text-xs">Cargar producto</button>}
          {editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.serviceInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "SERVICE" })} className="secondary-button text-xs">Cargar servicio</button>}
          {relation.operationalStatus === "COMPLETED" && relation.reconciliationStatus === "PENDING_RECONCILIATION" && relation.productInvoice?.recipientException?.status !== "PENDING" && permissions.canMatchInvoice && <LoadingButton type="button" loading={pending} disabled={pending} onClick={() => reconcile(relation)} loadingLabel="Conciliando…" className="text-xs">Conciliar</LoadingButton>}
          {relation.reconciliationStatus === "WITH_DIFFERENCES" && permissions.canReviewInvoice && <button type="button" onClick={() => setReinvoicing(relation)} className="secondary-button text-xs">Solicitar refacturación</button>}
          {permissions.canReviewInvoice && <RecipientExceptionButtons relation={relation} onSelect={setRecipientExceptionInvoice} />}
          {editable && relation.reconciliationStatus === "PENDING_REINVOICING" && permissions.canCreateInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT", replacement: true })} className="primary-button text-xs">Cargar factura refacturada</button>}
          {editable && permissions.canModify && <IconButton label="Remover despacho" tone="destructive" onClick={() => setRemove(relation)} className="size-9 border border-destructive/25"><Trash2 className="size-4" /></IconButton>}
        </div></td></tr>)}
      </tbody></table></div>
      <div className="divide-y divide-border lg:hidden">{detail.activeRelations.map((relation) => <article key={relation.relationId} className="p-3.5 sm:p-4"><div className="flex min-w-0 flex-col gap-3 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between"><div className="min-w-0"><DispatchDetailLink dispatchId={relation.dispatchId} projectId={project.id} className="block truncate font-semibold text-brand-strong disabled:cursor-wait disabled:opacity-60">{relation.programmingCode}</DispatchDetailLink><p className="mt-1 break-words text-sm font-medium text-foreground">{relation.supplierName}</p><p className="mt-1 text-xs text-foreground-muted">Pedido {relation.orderNumber ?? "Pendiente"} · {relation.guideCount} guía(s)</p></div><span className="w-fit"><StatusBadge label={relation.operationalStatus === "IN_EXECUTION" ? "Despacho en ejecución" : formatStatusLabel(relation.reconciliationStatus)} tone={relation.operationalStatus === "IN_EXECUTION" ? "info" : reconciliationTone(relation.reconciliationStatus)} /></span></div><dl className="mt-4 grid grid-cols-1 gap-3 rounded-lg bg-muted/45 p-3 text-xs min-[380px]:grid-cols-2"><div><dt className="text-foreground-muted">Volumen Real</dt><dd className="mt-1 font-semibold">{relation.realVolume === null ? "Pendiente" : `${formatBatchQuantity(relation.realVolume)} ${relation.realUnitCode ?? ""}`}</dd></div><div><dt className="text-foreground-muted">Estado operativo</dt><dd className="mt-1 font-semibold">{relation.operationalStatus === "COMPLETED" ? "Completado" : "En ejecución"}</dd></div><div><dt className="text-foreground-muted">Factura Producto</dt><dd className="mt-1"><InvoiceCell relation={relation} type="PRODUCT" /></dd></div><div><dt className="text-foreground-muted">Factura Servicio</dt><dd className="mt-1"><InvoiceCell relation={relation} type="SERVICE" /></dd></div></dl>{relation.latestAttempt && <p className="mt-3 text-xs leading-5 text-foreground-muted">Intento {relation.latestAttempt.attemptNumber}: diferencia {relation.latestAttempt.difference === null ? "no comparable" : formatBatchQuantity(relation.latestAttempt.difference)}</p>}<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"><DispatchDetailLink dispatchId={relation.dispatchId} projectId={project.id} className="secondary-button w-full text-xs disabled:cursor-wait disabled:opacity-60">Ver despacho</DispatchDetailLink>{editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.productInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT" })} className="secondary-button w-full text-xs">Cargar producto</button>}{editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.serviceInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "SERVICE" })} className="secondary-button w-full text-xs">Cargar servicio</button>}{relation.operationalStatus === "COMPLETED" && relation.reconciliationStatus === "PENDING_RECONCILIATION" && relation.productInvoice?.recipientException?.status !== "PENDING" && permissions.canMatchInvoice && <LoadingButton type="button" loading={pending} disabled={pending} onClick={() => reconcile(relation)} loadingLabel="Conciliando…" className="w-full text-xs">Conciliar</LoadingButton>}{relation.reconciliationStatus === "WITH_DIFFERENCES" && permissions.canReviewInvoice && <button type="button" onClick={() => setReinvoicing(relation)} className="secondary-button w-full text-xs">Solicitar refacturación</button>}{permissions.canReviewInvoice && <RecipientExceptionButtons relation={relation} onSelect={setRecipientExceptionInvoice} mobile />}{editable && relation.reconciliationStatus === "PENDING_REINVOICING" && permissions.canCreateInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT", replacement: true })} className="primary-button w-full text-xs">Cargar factura refacturada</button>}{editable && permissions.canModify && <button type="button" onClick={() => setRemove(relation)} className="destructive-button w-full gap-2 text-xs"><Trash2 className="size-4" /> Remover despacho</button>}</div></article>)}</div></> : <div className="p-4 sm:p-6"><EmptyState title="Sin despachos en el lote" description="Agrega un despacho en ejecución o completado del proyecto actual." /></div>}
    </MotionSection>

    <MotionSection disableMotion={embedded} className="overflow-hidden rounded-xl border border-border bg-surface"><button type="button" onClick={() => void toggleHistory()} disabled={secondaryPending} className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 border-b border-border px-4 py-3.5 text-left disabled:cursor-wait sm:px-5 sm:py-4"><span className="flex min-w-0 items-center gap-2"><History className="size-4 shrink-0 text-brand-strong" /><span className="break-words font-semibold">Historial de relaciones removidas</span></span>{secondaryPending ? <LoaderCircle className="size-4 shrink-0 animate-spin text-foreground-muted" /> : <ChevronDown className={`size-4 shrink-0 text-foreground-muted transition-transform ${historyOpen ? "rotate-180" : ""}`} />}</button>{historyOpen && ((resolvedSecondary?.removedRelations ?? []).length ? <div className="divide-y divide-border">{(resolvedSecondary?.removedRelations ?? []).map((relation) => <div key={relation.relationId} className="flex flex-col gap-2 px-4 py-4 text-sm sm:flex-row sm:justify-between sm:px-5"><div className="min-w-0"><strong className="break-all">{relation.programmingCode}</strong> · <span className="break-words">{relation.supplierName}</span><p className="text-xs leading-5 text-foreground-muted">{relation.removalReason ?? "Sin motivo"}{relation.rolledToBatchId ? " · trasladado al siguiente lote" : ""}</p></div><span className="text-xs text-foreground-muted">{relation.removedAt ? formatBatchDateTime(relation.removedAt, project.timezone) : "—"}</span></div>)}</div> : <p className="px-4 py-8 text-center text-sm text-foreground-muted sm:px-5">No hay relaciones removidas.</p>)}</MotionSection>

    {addOpen && <AddDispatchDialog projectId={project.id} batchId={detail.id} dispatches={detail.eligibleDispatches} onClose={() => setAddOpen(false)} onSuccess={refreshData} />}
    {bulkOpen && <BulkInvoiceDialog projectId={project.id} batchId={detail.id} onClose={() => setBulkOpen(false)} onSuccess={refreshData} />}
    {rolloverOpen && <RolloverDialog projectId={project.id} batchId={detail.id} preview={resolvedSecondary?.preview ?? []} onClose={() => setRolloverOpen(false)} onSuccess={refreshData} />}
    {remove && <RemoveDispatchDialog projectId={project.id} batchId={detail.id} relation={remove} onClose={() => setRemove(null)} onSuccess={refreshData} />}
    {invoice && <DispatchInvoiceDialog projectId={project.id} batchId={detail.id} relation={invoice.relation} type={invoice.type} replacement={invoice.replacement} onClose={() => setInvoice(null)} onSuccess={refreshData} />}
    {reinvoicing && <ReinvoicingDialog projectId={project.id} batchId={detail.id} relation={reinvoicing} onClose={() => setReinvoicing(null)} onSuccess={refreshData} />}
    {recipientExceptionInvoice && <RecipientExceptionDialog projectId={project.id} batchId={detail.id} invoice={recipientExceptionInvoice} onClose={() => setRecipientExceptionInvoice(null)} onSuccess={refreshData} />}
  </MotionPage>;
}
