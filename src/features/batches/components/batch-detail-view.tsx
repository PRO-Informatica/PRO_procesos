"use client";

import { ArrowLeft, FileSearch, Files, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import { StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import type { ProjectSummary } from "@/features/projects/types";
import { notifications } from "@/lib/notification-messages";
import { notify } from "@/lib/notify";
import { formatStatusLabel } from "@/lib/status-labels";

import { reconcileDispatchAction, requestDispatchReinvoicingAction } from "../actions";
import { formatBatchDate, formatBatchDateTime, formatBatchQuantity } from "../formatters";
import { initialBatchMutationState, type BatchDetail, type BatchDispatchRelation, type BatchPermissions, type InvoiceType, type ReconciliationStatus } from "../types";
import { AddDispatchDialog, Modal, RemoveDispatchDialog, RolloverDialog } from "./batch-dialogs";
import { BatchStatusBadge } from "./batch-status-badge";
import { BulkInvoiceDialog, DispatchInvoiceDialog } from "./invoice-dialogs";

type InvoiceSelection = { relation: BatchDispatchRelation; type: InvoiceType; replacement?: boolean };

function InvoiceCell({ relation, type }: { relation: BatchDispatchRelation; type: InvoiceType }) {
  const invoice = type === "PRODUCT" ? relation.productInvoice : relation.serviceInvoice;
  return invoice ? <div><p className="font-semibold">{invoice.number}</p><p className="text-xs text-foreground-muted">{formatBatchDate(invoice.date)}</p></div> : <span className="text-foreground-muted">Pendiente</span>;
}

function reconciliationTone(status: ReconciliationStatus): BadgeTone {
  if (status === "RECONCILED") return "success";
  if (["WITH_DIFFERENCES", "PENDING_REINVOICING"].includes(status)) return "warning";
  return "neutral";
}

function ReinvoicingDialog({ projectId, batchId, relation, onClose }: { projectId: string; batchId: string; relation: BatchDispatchRelation; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(requestDispatchReinvoicingAction, initialBatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.reinvoicingRequested });
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.status]);

  return (
    <Modal title="Solicitar refacturación" description="La factura original se conservará y la siguiente será una nueva factura vinculada." icon={FileSearch} onClose={onClose} pending={pending}>
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

export function BatchDetailView({ detail, project, permissions }: { detail: BatchDetail; project: ProjectSummary; permissions: BatchPermissions }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [remove, setRemove] = useState<BatchDispatchRelation | null>(null);
  const [invoice, setInvoice] = useState<InvoiceSelection | null>(null);
  const [reinvoicing, setReinvoicing] = useState<BatchDispatchRelation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = detail.status === "OPEN";

  function reconcile(relation: BatchDispatchRelation) {
    startTransition(async () => {
      const result = await reconcileDispatchAction(project.id, detail.id, relation.dispatchId);
      if (result.status === "success") {
        setMessage(null);
        if (result.reconciliationStatus === "RECONCILED") notify.success(notifications.reconciliationCompleted);
        else notify.warning(notifications.reconciliationDifferences);
        router.refresh();
      } else {
        setMessage(result.message);
        notify.error(notifications.actionFailed);
      }
    });
  }

  return <MotionPage className="mx-auto max-w-[1600px] space-y-5 pb-10">
    <MotionSection>
      <Link href="/batches" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"><ArrowLeft className="size-4" /> Volver a lotes</Link>
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Lote semanal</p><div className="mt-2 flex items-center gap-2"><h1 className="text-2xl font-semibold sm:text-3xl">{detail.code}</h1><BatchStatusBadge status={detail.status} /></div><p className="mt-2 text-sm text-foreground-muted">{formatBatchDate(detail.periodStart)} – {formatBatchDate(detail.periodEnd)} · Período contable {formatBatchDate(detail.accountingPeriod)}</p></div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          {permissions.canModify && editable && <button type="button" onClick={() => setAddOpen(true)} className="secondary-button w-full gap-2 sm:w-auto"><Plus className="size-4" /> Agregar despacho</button>}
          {permissions.canCreateInvoice && editable && <button type="button" onClick={() => setBulkOpen(true)} className="secondary-button w-full gap-2 sm:w-auto"><Files className="size-4" /> Carga masiva de facturas</button>}
          {permissions.canModify && editable && <button type="button" onClick={() => setRolloverOpen(true)} className="primary-button w-full gap-2 sm:w-auto"><RotateCcw className="size-4" /> Cerrar semana y preparar siguiente</button>}
        </div>
      </div>
      {message && <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm">{message}</p>}
    </MotionSection>

    <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Despachos del lote</h2><p className="mt-1 text-xs text-foreground-muted">Las guías son detalle interno; la pertenencia al lote y la conciliación pertenecen al despacho.</p></div>
      {detail.activeRelations.length ? <><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-foreground-muted"><tr><th className="p-4">Despacho</th><th className="p-4">Pedido</th><th className="p-4">Proveedor</th><th className="p-4">Volumen Real</th><th className="p-4">Factura Producto</th><th className="p-4">Factura Servicio</th><th className="p-4">Estado</th><th className="p-4 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">
        {detail.activeRelations.map((relation) => <tr key={relation.relationId} className="align-top"><td className="p-4"><Link href={`/dispatches/${relation.dispatchId}`} className="font-semibold text-brand-strong hover:underline">{relation.programmingCode}</Link><p className="mt-1 text-xs text-foreground-muted">{relation.operationalStatus === "COMPLETED" ? "Completado" : "En ejecución"} · {relation.guideCount} guía(s)</p></td><td className="p-4 font-semibold">{relation.orderNumber ?? "Pendiente"}</td><td className="p-4">{relation.supplierName}</td><td className="p-4 font-semibold">{relation.realVolume === null ? "Pendiente" : `${formatBatchQuantity(relation.realVolume)} ${relation.realUnitCode ?? ""}`}</td><td className="p-4"><InvoiceCell relation={relation} type="PRODUCT" /></td><td className="p-4"><InvoiceCell relation={relation} type="SERVICE" /></td><td className="p-4"><StatusBadge label={relation.operationalStatus === "IN_EXECUTION" ? "Despacho en ejecución" : formatStatusLabel(relation.reconciliationStatus)} tone={relation.operationalStatus === "IN_EXECUTION" ? "info" : reconciliationTone(relation.reconciliationStatus)} />{relation.latestAttempt && <p className="mt-2 text-xs text-foreground-muted">Intento {relation.latestAttempt.attemptNumber}: diferencia {relation.latestAttempt.difference === null ? "no comparable" : formatBatchQuantity(relation.latestAttempt.difference)}</p>}</td><td className="p-4"><div className="flex flex-wrap justify-end gap-2"><Link href={`/dispatches/${relation.dispatchId}`} className="secondary-button text-xs">Ver despacho</Link>
          {editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.productInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT" })} className="secondary-button text-xs">Cargar producto</button>}
          {editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.serviceInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "SERVICE" })} className="secondary-button text-xs">Cargar servicio</button>}
          {relation.operationalStatus === "COMPLETED" && relation.reconciliationStatus === "PENDING_RECONCILIATION" && permissions.canMatchInvoice && <LoadingButton type="button" loading={pending} disabled={pending} onClick={() => reconcile(relation)} loadingLabel="Conciliando…" className="text-xs">Conciliar</LoadingButton>}
          {relation.reconciliationStatus === "WITH_DIFFERENCES" && permissions.canReviewInvoice && <button type="button" onClick={() => setReinvoicing(relation)} className="secondary-button text-xs">Solicitar refacturación</button>}
          {editable && relation.reconciliationStatus === "PENDING_REINVOICING" && permissions.canCreateInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT", replacement: true })} className="primary-button text-xs">Cargar refacturada</button>}
          {editable && permissions.canModify && <IconButton label="Remover despacho" tone="destructive" onClick={() => setRemove(relation)} className="size-9 border border-destructive/25"><Trash2 className="size-4" /></IconButton>}
        </div></td></tr>)}
      </tbody></table></div>
      <div className="divide-y divide-border lg:hidden">{detail.activeRelations.map((relation) => <article key={relation.relationId} className="p-4"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><Link href={`/dispatches/${relation.dispatchId}`} className="block truncate font-semibold text-brand-strong">{relation.programmingCode}</Link><p className="mt-1 truncate text-sm font-medium text-foreground">{relation.supplierName}</p><p className="mt-1 text-xs text-foreground-muted">Pedido {relation.orderNumber ?? "Pendiente"} · {relation.guideCount} guía(s)</p></div><StatusBadge label={relation.operationalStatus === "IN_EXECUTION" ? "Despacho en ejecución" : formatStatusLabel(relation.reconciliationStatus)} tone={relation.operationalStatus === "IN_EXECUTION" ? "info" : reconciliationTone(relation.reconciliationStatus)} /></div><dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs"><div><dt className="text-foreground-muted">Volumen Real</dt><dd className="mt-1 font-semibold">{relation.realVolume === null ? "Pendiente" : `${formatBatchQuantity(relation.realVolume)} ${relation.realUnitCode ?? ""}`}</dd></div><div><dt className="text-foreground-muted">Estado operativo</dt><dd className="mt-1 font-semibold">{relation.operationalStatus === "COMPLETED" ? "Completado" : "En ejecución"}</dd></div><div><dt className="text-foreground-muted">Factura Producto</dt><dd className="mt-1"><InvoiceCell relation={relation} type="PRODUCT" /></dd></div><div><dt className="text-foreground-muted">Factura Servicio</dt><dd className="mt-1"><InvoiceCell relation={relation} type="SERVICE" /></dd></div></dl>{relation.latestAttempt && <p className="mt-3 text-xs text-foreground-muted">Intento {relation.latestAttempt.attemptNumber}: diferencia {relation.latestAttempt.difference === null ? "no comparable" : formatBatchQuantity(relation.latestAttempt.difference)}</p>}<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"><Link href={`/dispatches/${relation.dispatchId}`} className="secondary-button w-full text-xs">Ver despacho</Link>{editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.productInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT" })} className="secondary-button w-full text-xs">Cargar producto</button>}{editable && relation.operationalStatus === "COMPLETED" && permissions.canCreateInvoice && !relation.serviceInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "SERVICE" })} className="secondary-button w-full text-xs">Cargar servicio</button>}{relation.operationalStatus === "COMPLETED" && relation.reconciliationStatus === "PENDING_RECONCILIATION" && permissions.canMatchInvoice && <LoadingButton type="button" loading={pending} disabled={pending} onClick={() => reconcile(relation)} loadingLabel="Conciliando…" className="w-full text-xs">Conciliar</LoadingButton>}{relation.reconciliationStatus === "WITH_DIFFERENCES" && permissions.canReviewInvoice && <button type="button" onClick={() => setReinvoicing(relation)} className="secondary-button w-full text-xs">Solicitar refacturación</button>}{editable && relation.reconciliationStatus === "PENDING_REINVOICING" && permissions.canCreateInvoice && <button type="button" onClick={() => setInvoice({ relation, type: "PRODUCT", replacement: true })} className="primary-button w-full text-xs">Cargar refacturada</button>}{editable && permissions.canModify && <button type="button" onClick={() => setRemove(relation)} className="destructive-button w-full gap-2 text-xs"><Trash2 className="size-4" /> Remover despacho</button>}</div></article>)}</div></> : <div className="p-4 sm:p-6"><EmptyState title="Sin despachos en el lote" description="Agrega un despacho en ejecución o completado del proyecto actual." /></div>}
    </MotionSection>

    <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface"><div className="flex items-center gap-2 border-b border-border px-5 py-4"><History className="size-4 text-brand-strong" /><h2 className="font-semibold">Historial de relaciones removidas</h2></div>{detail.removedRelations.length ? <div className="divide-y divide-border">{detail.removedRelations.map((relation) => <div key={relation.relationId} className="flex flex-col gap-2 px-5 py-4 text-sm sm:flex-row sm:justify-between"><div><strong>{relation.programmingCode}</strong> · {relation.supplierName}<p className="text-xs text-foreground-muted">{relation.removalReason ?? "Sin motivo"}{relation.rolledToBatchId ? " · trasladado al siguiente lote" : ""}</p></div><span className="text-xs text-foreground-muted">{relation.removedAt ? formatBatchDateTime(relation.removedAt, project.timezone) : "—"}</span></div>)}</div> : <p className="px-5 py-8 text-center text-sm text-foreground-muted">No hay relaciones removidas.</p>}</MotionSection>

    {addOpen && <AddDispatchDialog projectId={project.id} batchId={detail.id} dispatches={detail.eligibleDispatches} onClose={() => setAddOpen(false)} />}
    {bulkOpen && <BulkInvoiceDialog projectId={project.id} batchId={detail.id} onClose={() => setBulkOpen(false)} />}
    {rolloverOpen && <RolloverDialog projectId={project.id} batchId={detail.id} preview={detail.preview} onClose={() => setRolloverOpen(false)} />}
    {remove && <RemoveDispatchDialog projectId={project.id} batchId={detail.id} relation={remove} onClose={() => setRemove(null)} />}
    {invoice && <DispatchInvoiceDialog projectId={project.id} batchId={detail.id} relation={invoice.relation} type={invoice.type} replacement={invoice.replacement} onClose={() => setInvoice(null)} />}
    {reinvoicing && <ReinvoicingDialog projectId={project.id} batchId={detail.id} relation={reinvoicing} onClose={() => setReinvoicing(null)} />}
  </MotionPage>;
}
