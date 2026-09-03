"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  PackageOpen,
  Plus,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { DocumentActions } from "@/components/documents/document-preview-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingButton } from "@/components/feedback/loading-button";
import { MotionPage } from "@/components/motion/motion-page";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import {
  finalizeDispatchAction,
  getDocumentDownloadUrl,
  removeDispatchEvidenceAction,
  saveDispatchAction,
} from "../actions";
import {
  formatDispatchDate,
  formatDispatchDateTime,
  formatDispatchQuantity,
} from "../formatters";
import {
  initialDispatchMutationState,
  type DispatchDetail,
  type DispatchDocument,
  type DispatchGuide,
  type DispatchPermissions,
  type DispatchResult,
} from "../types";
import { realVolumeWarning } from "../validation";
import { DispatchResultBadge, DispatchStatusBadge } from "./dispatch-badges";
import { DispatchGuideDialog } from "./dispatch-guide-dialog";
import { DocumentUploader } from "./document-uploader";
import { RegisterIncidentDialog } from "./register-incident-dialog";

function SectionHeader({ icon: Icon, title, count }: { icon: typeof Truck; title: string; count?: number }) {
  return <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6"><div className="flex items-center gap-2"><Icon className="size-5 text-brand-strong" /><h2 className="font-semibold">{title}</h2></div>{count !== undefined && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{count}</span>}</div>;
}

function localDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localTime(value: string | null, timezone: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

function guideVolume(guides: DispatchGuide[]) {
  return guides.reduce((total, guide) => total + guide.quantity, 0);
}

function EvidenceRow({
  document,
  project,
  editable,
}: {
  document: DispatchDocument;
  project: ProjectSummary;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <p className="break-all text-sm font-semibold">
          {document.fileName ?? "Archivo pendiente"}
        </p>
        <p className="mt-1 text-xs text-foreground-muted">
          {document.mimeType ?? "Tipo no disponible"} ·{" "}
          {formatDispatchDateTime(document.createdAt, project.timezone)}
        </p>
        <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground-muted">
          {formatStatusLabel(document.uploadStatus)}
        </span>
      </div>
      <div className="flex gap-2">
        {document.uploadStatus === "UPLOADED" &&
          document.fileName &&
          document.mimeType && (
            <DocumentActions
              projectId={project.id}
              documentId={document.id}
              fileName={document.fileName}
              mimeType={document.mimeType}
              getSignedUrl={getDocumentDownloadUrl}
              compact
            />
          )}
        {editable && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await removeDispatchEvidenceAction(
                  project.id,
                  document.id,
                );
                if (result.status === "success") router.refresh();
              })
            }
            className="grid size-9 place-items-center rounded-lg border border-border text-destructive hover:bg-destructive-soft disabled:opacity-50"
            aria-label={`Eliminar ${document.fileName ?? "evidencia"}`}
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}

export function DispatchDetailView({ detail, project, permissions }: { detail: DispatchDetail; project: ProjectSummary; permissions: DispatchPermissions }) {
  const router = useRouter();
  const editable = detail.status === "IN_EXECUTION" && permissions.canModify;
  const operationDate = localDate(detail.programmingScheduledAt, project.timezone);
  const [saveState, saveAction] = useActionState(saveDispatchAction, initialDispatchMutationState);
  const [completeState, completeAction, completing] = useActionState(finalizeDispatchAction, initialDispatchMutationState);
  const [guide, setGuide] = useState<DispatchGuide | "new" | null>(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receiverName, setReceiverName] = useState(detail.receivedByName ?? "");
  const [arrivalTime, setArrivalTime] = useState(localTime(detail.arrivalAt, project.timezone));
  const [departureTime, setDepartureTime] = useState(localTime(detail.departureAt, project.timezone));
  const [result, setResult] = useState<DispatchResult | "">(detail.result ?? "");
  const [orderNumber, setOrderNumber] = useState(detail.orderNumber ?? "");
  const [realVolume, setRealVolume] = useState(detail.realVolume === null ? String(detail.guideTotal || "") : String(detail.realVolume));
  const [realUnitCode, setRealUnitCode] = useState(detail.realUnitCode ?? detail.programmedUnitCode);
  const total = useMemo(() => guideVolume(detail.guides), [detail.guides]);
  const uploadedEvidenceCount = detail.documents.filter((document) => document.uploadStatus === "UPLOADED").length;
  const warning = realVolumeWarning(total, realVolume === "" ? null : Number(realVolume));
  useEffect(() => {
    if (saveState.status === "success" || completeState.status === "success") {
      router.refresh();
    }
  }, [completeState.status, router, saveState.status]);

  return <MotionPage className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
    <div><Link href="/dispatches" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"><ArrowLeft className="size-4" /> Volver a despachos</Link><div className="mt-4 flex flex-wrap items-center gap-3"><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Detalle de despacho</h1><p className="mt-1 text-sm text-foreground-muted">{detail.programmingCode} · {detail.supplierName}</p></div><DispatchStatusBadge status={detail.status} /><DispatchResultBadge result={detail.result} /></div></div>

    <form action={saveAction} className="space-y-6">
      <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="dispatchId" value={detail.id} /><input type="hidden" name="programmingId" value={detail.programmingId} /><input type="hidden" name="expectedVersion" value={detail.version} />
      <input type="hidden" name="arrivalAt" value={arrivalTime ? `${operationDate}T${arrivalTime}` : ""} /><input type="hidden" name="departureAt" value={departureTime ? `${operationDate}T${departureTime}` : ""} />
      <section className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={Truck} title="Información general" /><div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6"><div><p className="form-label">Programación</p><Link href={`/programming/${detail.programmingId}`} className="font-mono text-sm font-semibold text-brand-strong hover:underline">{detail.programmingCode}</Link></div><div><p className="form-label">Proveedor</p><p className="text-sm font-semibold">{detail.supplierName}</p></div><div><p className="form-label">Fecha</p><p className="text-sm font-semibold">{formatDispatchDateTime(detail.programmingScheduledAt, project.timezone)}</p></div><div><p className="form-label">Estado</p><DispatchStatusBadge status={detail.status} /></div><div><label className="form-label" htmlFor="dispatch-receiver">Receptor</label><input id="dispatch-receiver" name="receivedByName" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} required disabled={!editable} className="form-input disabled:bg-muted" /></div><div><label className="form-label" htmlFor="dispatch-arrival">Hora llegada</label><input id="dispatch-arrival" type="time" value={arrivalTime} onChange={(event) => setArrivalTime(event.target.value)} required disabled={!editable} className="form-input disabled:bg-muted" /><p className="mt-1 text-xs text-foreground-muted">Día de la programación: {formatDispatchDate(operationDate)}</p></div><div><label className="form-label" htmlFor="dispatch-departure">Hora salida</label><input id="dispatch-departure" type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} disabled={!editable} className="form-input disabled:bg-muted" /><p className="mt-1 text-xs text-foreground-muted">Final de la última entrega, el mismo día.</p></div><div><p className="form-label">Resultado</p><DispatchResultBadge result={detail.result} /></div></div></section>

      <section id="guides" className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={PackageOpen} title="Guías de despacho" count={detail.guides.length} />{detail.guides.length ? <><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/50 text-xs text-foreground-muted"><tr><th className="px-5 py-3">Guía</th><th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Productos</th><th className="px-5 py-3">Volumen</th><th className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">{detail.guides.map((item) => <tr key={item.id}><td className="px-5 py-4 font-semibold">{item.guideNumber}</td><td className="px-5 py-4 text-foreground-muted">{formatDispatchDate(item.guideDate)}</td><td className="px-5 py-4">{item.productCount}</td><td className="px-5 py-4 font-semibold">{formatDispatchQuantity(item.quantity)} {item.unitCode}</td><td className="px-5 py-4 text-right">{editable ? <button type="button" onClick={() => setGuide(item)} className="text-xs font-semibold text-brand-strong hover:underline">Ver / Editar</button> : <button type="button" onClick={() => setGuide(item)} className="text-xs font-semibold text-brand-strong hover:underline">Ver</button>}</td></tr>)}</tbody></table></div><div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="font-semibold">Total según guías: {formatDispatchQuantity(total)} {detail.programmedUnitCode}</p>{editable && <button type="button" onClick={() => setGuide("new")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white"><Plus className="size-4" /> Agregar guía</button>}</div></> : <div className="p-5 sm:p-6"><EmptyState title="Sin guías registradas" description={editable ? "Agrega la primera guía de esta operación." : "El despacho no tiene guías."} action={editable ? <button type="button" onClick={() => setGuide("new")} className="primary-button"><Plus className="size-4" /> Agregar guía</button> : undefined} /></div>}</section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={ClipboardList} title="Pedido / Control Operación" /><div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-5 sm:p-6"><div><label className="form-label" htmlFor="dispatch-result">Resultado de la operación *</label><select id="dispatch-result" name="result" value={result} onChange={(event) => { const value = event.target.value as DispatchResult | ""; setResult(value); if (value === "NOT_DISPATCHED") setRealVolume("0"); }} disabled={!editable} className="form-input disabled:bg-muted"><option value="">Seleccionar</option><option value="DISPATCHED">Despachado</option><option value="NOT_DISPATCHED">No despachado</option></select></div><div><label className="form-label" htmlFor="dispatch-order">Número pedido</label><input id="dispatch-order" name="orderNumber" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} disabled={!editable || result === "NOT_DISPATCHED"} className="form-input disabled:bg-muted" /></div><div><p className="form-label">Volumen programado</p><p className="mt-2 text-lg font-semibold">{formatDispatchQuantity(detail.programmedVolume)} {detail.programmedUnitCode}</p></div><div><p className="form-label">Total según guías</p><p className="mt-2 text-lg font-semibold">{formatDispatchQuantity(total)} {detail.programmedUnitCode}</p></div><div className="rounded-xl border border-brand/25 bg-brand-soft/25 p-4"><label className="form-label text-brand-strong" htmlFor="dispatch-real-volume">Volumen Real *</label><div className="mt-1 flex gap-2"><input id="dispatch-real-volume" name="realVolume" type="number" min="0" step="0.001" value={result === "NOT_DISPATCHED" ? "0" : realVolume} onChange={(event) => setRealVolume(event.target.value)} disabled={!editable || result === "NOT_DISPATCHED"} className="form-input min-w-0 disabled:bg-muted" /><select aria-label="UM real" name="realUnitCode" value={realUnitCode} onChange={(event) => setRealUnitCode(event.target.value)} disabled={!editable} className="form-input w-24 disabled:bg-muted">{detail.units.map((unit) => <option key={unit.code} value={unit.code}>{unit.code}</option>)}</select></div><p className="mt-2 text-xs text-brand-strong">Valor oficial preparado para conciliación.</p></div>{warning && result === "DISPATCHED" && <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900 sm:col-span-2 lg:col-span-5">{warning}</p>}</div></section>

      {detail.reconciliation && <section className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={ClipboardList} title="Facturas y conciliación" /><div className="grid gap-4 p-5 text-sm sm:grid-cols-4 sm:p-6"><div><p className="form-label">Factura Producto</p><p className="font-semibold">{detail.reconciliation.productInvoiceNumber ?? "Pendiente"}</p></div><div><p className="form-label">Factura Servicio</p><p className="font-semibold">{detail.reconciliation.serviceInvoiceNumber ?? "Pendiente"}</p></div><div><p className="form-label">Estado</p><p className="font-semibold">{formatStatusLabel(detail.reconciliation.status)}</p></div><div><p className="form-label">Última diferencia</p><p className="font-semibold">{detail.reconciliation.latestDifference === null ? "—" : formatDispatchQuantity(detail.reconciliation.latestDifference)}</p></div></div>{detail.batches.find((batch) => !batch.removedAt) && <div className="border-t border-border px-5 py-4 sm:px-6"><Link href={`/batches/${detail.batches.find((batch) => !batch.removedAt)!.batchId}`} className="font-semibold text-brand-strong hover:underline">Gestionar facturas en el lote</Link></div>}</section>}

      <div className="grid gap-6 xl:grid-cols-2"><section className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={AlertTriangle} title="Incidencias" count={detail.incidents.length} />{detail.incidents.length ? <ul className="divide-y divide-border">{detail.incidents.map((incident) => <li key={incident.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{incident.typeName}</p><span className="text-xs text-foreground-muted">{formatDispatchDateTime(incident.createdAt, project.timezone)}</span></div><p className="mt-2 text-xs text-foreground-muted">Responsabilidad: {formatStatusLabel(incident.responsibility)} · Aplica cobro: {formatStatusLabel(incident.chargeApplicability)}</p>{incident.notes && <p className="mt-2 text-sm">{incident.notes}</p>}</li>)}</ul> : <div className="p-5"><EmptyState title="Sin incidencias registradas" description="El resultado Despachado puede finalizar sin incidencias; No despachado requiere al menos una." /></div>}{detail.status === "IN_EXECUTION" && permissions.canRegisterIncident && <div className="border-t border-border px-5 py-4 sm:px-6"><button type="button" onClick={() => setIncidentOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"><Plus className="size-4" /> Registrar incidencia</button></div>}</section>
      <section className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={FileText} title="Evidencias" count={detail.documents.length} />{detail.documents.length ? <ul className="divide-y divide-border">{detail.documents.map((document) => <EvidenceRow key={document.id} document={document} project={project} editable={editable} />)}</ul> : <div className="p-5"><EmptyState title="Sin evidencias" description="Debes adjuntar al menos una imagen o archivo PDF antes de finalizar." /></div>}{editable && <div className="border-t border-border px-5 py-4 sm:px-6"><DocumentUploader projectId={project.id} contextId={detail.id} context="dispatch" label="Agregar evidencias" /></div>}</section></div>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface"><SectionHeader icon={CalendarClock} title="Lotes" count={detail.batches.length} />{detail.batches.length ? <ul className="divide-y divide-border">{detail.batches.map((relation) => <li key={relation.relationId} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><Link href={`/batches/${relation.batchId}`} className="font-semibold text-brand-strong hover:underline">{relation.code}</Link><p className="mt-1 text-xs text-foreground-muted">Despacho completo · {formatDispatchDate(relation.periodStart)} — {formatDispatchDate(relation.periodEnd)}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-foreground-muted">{relation.removedAt ? "Histórico" : formatStatusLabel(relation.status)}</span></li>)}</ul> : <div className="p-5"><EmptyState title="Sin lote" description="Este despacho todavía no ha sido asignado a un lote." /></div>}</section>

      {(saveState.status === "error" || completeState.status === "error") && <p role="alert" className="rounded-xl bg-destructive-soft px-4 py-3 text-sm text-destructive">{saveState.status === "error" ? saveState.message : completeState.message}</p>}
      {saveState.status === "success" && <p className="rounded-xl bg-success-soft px-4 py-3 text-sm text-success">{saveState.message}</p>}
      {editable && <div className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-end">{uploadedEvidenceCount === 0 && <p className="text-xs font-medium text-destructive sm:mr-auto">Carga al menos una evidencia antes de finalizar.</p>}<LoadingButton loadingLabel="Guardando…">Guardar cambios</LoadingButton><button type="button" disabled={uploadedEvidenceCount === 0} title={uploadedEvidenceCount === 0 ? "Carga al menos una evidencia antes de finalizar." : undefined} onClick={() => setConfirmOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-45"><CheckCircle2 className="size-4" /> Finalizar despacho</button></div>}
    </form>

    {guide && <DispatchGuideDialog projectId={project.id} programmingId={detail.programmingId} dispatchId={detail.id} expectedVersion={detail.version} programmedUnitCode={detail.programmedUnitCode} units={detail.units} guide={guide === "new" ? undefined : guide} onClose={() => setGuide(null)} />}
    {incidentOpen && <RegisterIncidentDialog projectId={project.id} dispatchId={detail.id} types={detail.incidentTypes} onClose={() => setIncidentOpen(false)} />}
    {confirmOpen && completeState.status !== "success" && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 className="text-lg font-semibold">¿Finalizar despacho?</h2><p className="mt-1 text-sm text-foreground-muted">Se guardarán los datos actuales y se finalizará el despacho.</p></div><button type="button" onClick={() => setConfirmOpen(false)} disabled={completing} className="grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label="Cerrar"><X className="size-5" /></button></div><form action={completeAction} className="space-y-4 p-5"><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="dispatchId" value={detail.id} /><input type="hidden" name="programmingId" value={detail.programmingId} /><input type="hidden" name="expectedVersion" value={detail.version} /><input type="hidden" name="arrivalAt" value={arrivalTime ? `${operationDate}T${arrivalTime}` : ""} /><input type="hidden" name="departureAt" value={departureTime ? `${operationDate}T${departureTime}` : ""} /><input type="hidden" name="receivedByName" value={receiverName} /><input type="hidden" name="result" value={result} /><input type="hidden" name="orderNumber" value={orderNumber} /><input type="hidden" name="realVolume" value={result === "NOT_DISPATCHED" ? "0" : realVolume} /><input type="hidden" name="realUnitCode" value={realUnitCode} />{completeState.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{completeState.message}</p>}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setConfirmOpen(false)} disabled={completing} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold">Cancelar</button><LoadingButton loadingLabel="Finalizando…">Finalizar despacho</LoadingButton></div></form></div></div>}
  </MotionPage>;
}
