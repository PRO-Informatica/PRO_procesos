"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileText,
  PackageOpen,
  PencilLine,
  ReceiptText,
  Truck,
  UserRound,
  Plus,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import type { ProjectSummary } from "@/features/projects/types";

import {
  formatDispatchDate,
  formatDispatchDateTime,
  formatDispatchQuantity,
  formatIdentifier,
} from "../formatters";
import type { DispatchDetail, DispatchDocument, DispatchPermissions } from "../types";
import { DispatchResultBadge, DispatchStatusBadge } from "./dispatch-badges";
import { CorrectDispatchGuideDialog } from "./correct-dispatch-guide-dialog";
import { DocumentDownloadButton, DocumentUploader } from "./document-uploader";
import { RegisterIncidentDialog } from "./register-incident-dialog";

function DataPoint({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">{label}</dt>
      <dd className="mt-1.5 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Truck;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-5 text-brand-strong" />
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      {count !== undefined && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{count}</span>}
    </div>
  );
}

function documentStatusLabel(status: string | null) {
  if (status === "UPLOADED") return "Disponible";
  if (status === "PENDING") return "Carga pendiente";
  if (status === "FAILED") return "Carga fallida";
  return "Sin archivo disponible";
}

function documentTypeLabel(mimeType: string | null) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "image/jpeg") return "Imagen JPEG";
  if (mimeType === "image/png") return "Imagen PNG";
  if (mimeType === "image/webp") return "Imagen WebP";
  return "Tipo no disponible";
}

function DocumentList({
  documents,
  project,
  retryContextId,
  retryContext,
  canRetry,
}: {
  documents: DispatchDocument[];
  project: ProjectSummary;
  retryContextId: string;
  retryContext: "guide" | "incident";
  canRetry: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {documents.map((document) => (
        <li key={document.id} className="px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all font-semibold text-foreground">{document.fileName ?? "Documento sin archivo"}</p>
              <p className="mt-1 text-xs text-foreground-muted">{documentTypeLabel(document.mimeType)}</p>
              <p className="mt-1 text-xs text-foreground-muted">{formatDispatchDateTime(document.createdAt, project.timezone)} · {document.createdByName}</p>
              <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${document.uploadStatus === "UPLOADED" ? "bg-success-soft text-success" : document.uploadStatus === "FAILED" ? "bg-destructive-soft text-destructive" : "bg-muted text-foreground-muted"}`}>{documentStatusLabel(document.uploadStatus)}</span>
            </div>
            {document.uploadStatus === "UPLOADED" && <DocumentDownloadButton projectId={project.id} documentId={document.id} />}
          </div>
          {canRetry && document.uploadStatus === "FAILED" && (
            <div className="mt-3">
              <DocumentUploader projectId={project.id} contextId={retryContextId} context={retryContext} label="Reintentar carga" existingDocumentId={document.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DispatchDetailView({
  detail,
  project,
  permissions,
}: {
  detail: DispatchDetail;
  project: ProjectSummary;
  permissions: DispatchPermissions;
}) {
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const canCorrectGuide = permissions.canModify
    && detail.status === "REGISTERED"
    && detail.batches.length === 0
    && detail.invoices.length === 0
    && Boolean(detail.guideId && detail.guideTemplateVersionId);
  const guideDocuments = detail.documents.filter((document) => document.context === "guide");
  return (
    <MotionPage className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/dispatches" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-4" /> Volver a despachos
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Detalle de despacho</h1>
            <DispatchStatusBadge status={detail.status} />
            <DispatchResultBadge result={detail.result} />
          </div>
          <p className="mt-2 font-mono text-xs text-foreground-muted">
            {formatIdentifier("DSP", detail.id)} · versión {detail.version} · {project.name}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
          <p className="text-xs text-foreground-muted">Guía asociada</p>
          <p className="mt-1 font-semibold text-foreground">{detail.guideNumber ?? "Sin guía"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canCorrectGuide && <button type="button" onClick={() => setCorrectionOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted"><PencilLine aria-hidden="true" className="size-4" /> Corregir guía</button>}
            {permissions.canRegisterIncident && <button type="button" onClick={() => setIncidentOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong"><Plus className="size-4" /> Registrar incidencia</button>}
            {permissions.canModify && detail.guideId && <DocumentUploader projectId={project.id} contextId={detail.guideId} context="guide" label="Adjuntar guía" />}
          </div>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-2"><Truck aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Información operacional</h2></div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DataPoint label="Proveedor" value={detail.supplierName} />
            <DataPoint label="Programación" value={<Link href={`/programming/${detail.programmingId}`} className="font-mono text-brand-strong hover:underline">{detail.programmingCode}</Link>} />
            <DataPoint label="Estado programación" value={detail.programmingStatus.replaceAll("_", " ")} />
            <DataPoint label="Fecha programada" value={formatDispatchDateTime(detail.programmingScheduledAt, project.timezone)} />
            <DataPoint label="Creado por" value={detail.createdByName} />
            <DataPoint label="Creado" value={formatDispatchDateTime(detail.createdAt, project.timezone)} />
            <DataPoint label="Actualizado" value={formatDispatchDateTime(detail.updatedAt, project.timezone)} />
            <DataPoint label="Estado del proceso" value={<DispatchStatusBadge status={detail.status} />} />
            <DataPoint label="Resultado físico" value={<DispatchResultBadge result={detail.result} />} />
          </dl>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-2"><ClipboardList aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Guía y recepción</h2></div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <DataPoint label="Número de guía" value={detail.guideNumber ?? "No registrada"} />
            <DataPoint label="Orden" value={detail.guideOrderNumber ?? "No registrada"} />
            <DataPoint label="Fecha de guía" value={formatDispatchDate(detail.guideDate)} />
            <DataPoint label="Cantidad documentada" value={detail.quantity === null ? "No registrada" : `${formatDispatchQuantity(detail.quantity)} ${detail.unitCode}`} />
            <DataPoint label="Cantidad enviada" value={detail.dispatchedQuantity === null ? "No registrada" : `${formatDispatchQuantity(detail.dispatchedQuantity)} ${detail.unitCode}`} />
            <DataPoint label="Cantidad recibida" value={detail.receivedQuantity === null ? "No registrada" : `${formatDispatchQuantity(detail.receivedQuantity)} ${detail.unitCode}`} />
            <DataPoint label="Cantidad devuelta" value={detail.returnedQuantity === null ? "No registrada" : `${formatDispatchQuantity(detail.returnedQuantity)} ${detail.unitCode}`} />
            <DataPoint label="Receptor" value={detail.receivedByName ?? "No registrado"} />
            <DataPoint label="Carga" value={formatDispatchDateTime(detail.loadAt, project.timezone)} />
            <DataPoint label="Llegada" value={formatDispatchDateTime(detail.arrivalAt, project.timezone)} />
            <DataPoint label="Salida" value={formatDispatchDateTime(detail.departureAt, project.timezone)} />
          </dl>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <SectionHeader icon={PackageOpen} title="Productos de la guía" count={detail.guideLines.length} />
        {detail.guideLines.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-foreground-muted"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Código</th><th className="px-5 py-3">Descripción</th><th className="px-5 py-3 text-right">Cantidad</th><th className="px-5 py-3">UM</th></tr></thead>
                <tbody className="divide-y divide-border">{detail.guideLines.map((line) => <tr key={line.id}><td className="px-5 py-4 font-mono text-xs text-foreground-muted">{line.position}</td><td className="px-5 py-4 font-mono text-xs font-semibold text-foreground">{line.productCode}</td><td className="px-5 py-4 text-foreground">{line.productDescription}</td><td className="px-5 py-4 text-right font-semibold text-foreground">{formatDispatchQuantity(line.quantity)}</td><td className="px-5 py-4 font-semibold text-foreground">{line.unitCode}</td></tr>)}</tbody>
              </table>
            </div>
            <ol className="divide-y divide-border md:hidden">{detail.guideLines.map((line) => <li key={line.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-semibold text-brand-strong">{line.position} · {line.productCode}</p><p className="mt-1 text-sm text-foreground">{line.productDescription}</p></div><p className="shrink-0 font-semibold text-foreground">{formatDispatchQuantity(line.quantity)} {line.unitCode}</p></div></li>)}</ol>
          </>
        ) : <div className="p-5 sm:p-6"><EmptyState title="Sin líneas de guía" description="No hay productos visibles asociados a esta guía." /></div>}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={FileText} title="Documentos de guía" count={guideDocuments.length} />
          {guideDocuments.length && detail.guideId ? (
            <DocumentList documents={guideDocuments} project={project} retryContextId={detail.guideId} retryContext="guide" canRetry={permissions.canModify} />
          ) : (
            <div className="p-5 sm:p-6"><EmptyState title="Aún no se ha adjuntado la guía física" description="Puedes agregar una foto o PDF sin afectar el despacho ya registrado." /></div>
          )}
          {permissions.canModify && detail.guideId && (
            <div className="border-t border-border px-5 py-4 sm:px-6"><DocumentUploader projectId={project.id} contextId={detail.guideId} context="guide" label="Subir foto o PDF" /></div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={AlertTriangle} title="Incidencias" count={detail.incidents.length} />
          {detail.incidents.length ? <ul className="divide-y divide-border">{detail.incidents.map((incident) => { const evidence = detail.documents.filter((document) => document.context === "incident" && document.incidentId === incident.id); return <li key={incident.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{incident.typeName}</p><span className="text-xs text-foreground-muted">{formatDispatchDateTime(incident.createdAt, project.timezone)}</span></div><p className="mt-2 text-xs text-foreground-muted">Responsabilidad: {incident.responsibility} · Cargo: {incident.chargeApplicability}</p>{incident.notes && <p className="mt-2 text-sm leading-6 text-foreground">{incident.notes}</p>}<p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted"><UserRound aria-hidden="true" className="size-3.5" /> {incident.reporterName}</p><div className="mt-4 rounded-xl border border-border bg-muted/20"><div className="px-4 py-3"><p className="text-xs font-semibold text-foreground">Evidencias de la incidencia</p>{!evidence.length && <p className="mt-1 text-xs text-foreground-muted">Esta incidencia no tiene evidencia adjunta.</p>}</div>{evidence.length > 0 && <DocumentList documents={evidence} project={project} retryContextId={incident.id} retryContext="incident" canRetry={permissions.canRegisterIncident} />}{permissions.canRegisterIncident && <div className="border-t border-border p-4"><DocumentUploader projectId={project.id} contextId={incident.id} context="incident" label="Subir evidencia" /></div>}</div></li>; })}</ul> : <div className="p-5 sm:p-6"><EmptyState title="No hay incidencias registradas" description="Puedes registrar una incidencia desde la acción superior cuando sea necesario." /></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={CalendarClock} title="Lotes" count={detail.batches.length} />
          {detail.batches.length ? <ul className="divide-y divide-border">{detail.batches.map((relation) => <li key={relation.relationId} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{relation.code}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${relation.removedAt ? "bg-muted text-foreground-muted" : "bg-success-soft text-success"}`}>{relation.removedAt ? "Histórico" : "Activo"}</span></div><p className="mt-2 text-xs text-foreground-muted">{formatDispatchDate(relation.periodStart)} — {formatDispatchDate(relation.periodEnd)} · período {relation.accountingPeriod}</p><p className="mt-1 text-xs text-foreground-muted">{relation.status} · asignación {relation.assignmentSource}</p></li>)}</ul> : <div className="p-5 sm:p-6"><EmptyState title="Sin lote" description="La guía todavía no tiene asignaciones de lote visibles." /></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={ReceiptText} title="Facturas relacionadas" count={detail.invoices.length} />
          {detail.invoices.length ? <ul className="divide-y divide-border">{detail.invoices.map((invoice) => <li key={invoice.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{invoice.number}</p><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground-muted">{invoice.status}</span></div><p className="mt-2 text-xs text-foreground-muted">{invoice.invoiceType} · {formatDispatchDate(invoice.invoiceDate)}</p><p className="mt-2 font-semibold text-foreground">{invoice.currency} {formatDispatchQuantity(invoice.total)}</p></li>)}</ul> : <div className="p-5 sm:p-6"><EmptyState title="Sin facturas" description="No hay facturas relacionadas con esta guía." /></div>}
        </section>
      </div>
      <AnimatePresence>{incidentOpen && <RegisterIncidentDialog projectId={project.id} dispatchId={detail.id} types={detail.incidentTypes} onClose={() => setIncidentOpen(false)} />}</AnimatePresence>
      {correctionOpen && <CorrectDispatchGuideDialog open detail={detail} timezone={project.timezone || "America/Guatemala"} onClose={() => setCorrectionOpen(false)} />}
    </MotionPage>
  );
}
