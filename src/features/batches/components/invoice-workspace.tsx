"use client";

import {
  FileCheck2,
  FilePlus2,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { DocumentActions } from "@/components/documents/document-preview-dialog";
import { createClient } from "@/lib/supabase/client";
import { formatStatusLabel } from "@/lib/status-labels";

import {
  confirmInvoiceExtraction,
  failInvoiceUpload,
  finalizeInvoiceUpload,
  getInvoiceDownloadUrl,
  prepareInvoiceUpload,
  reconcileInvoice,
} from "../actions";
import { formatBatchDate, formatBatchQuantity } from "../formatters";
import type {
  BatchDetail,
  BatchInvoice,
  BatchPermissions,
  InvoiceExtractionPayload,
  InvoiceUploadLine,
} from "../types";
import { Modal } from "./batch-dialogs";

const ACCEPT = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_SIZE = 10 * 1024 * 1024;

function amount(value: number, currency: string) {
  return new Intl.NumberFormat("es-GT", { style: "currency", currency }).format(
    value,
  );
}

function invoiceTone(status: string) {
  if (["APPROVED", "MATCHED"].includes(status))
    return "bg-success-soft text-success";
  if (status === "REINVOICING") return "bg-destructive-soft text-destructive";
  return "bg-muted text-foreground-muted";
}

function parseLine(form: HTMLFormElement): InvoiceUploadLine[] {
  const data = new FormData(form);
  return [
    {
      code: String(data.get("lineCode") ?? "").trim() || undefined,
      description: String(data.get("lineDescription") ?? "").trim(),
      quantity: Number(data.get("lineQuantity")),
      unit_code: String(data.get("lineUnit") ?? "").trim() || undefined,
      unit_price: Number(data.get("lineUnitPrice")) || undefined,
      line_total: Number(data.get("lineTotal")) || undefined,
    },
  ];
}

function InvoiceUploadDialog({
  detail,
  replacement,
  onClose,
}: {
  detail: BatchDetail;
  replacement: BatchInvoice | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useGlobalPending(
    busy,
    "Registrando factura…",
    "Cargando el documento privado y preparando su extracción.",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const guideIds = data.getAll("guideIds").map(String);
    const lines = parseLine(form);
    if (
      !(file instanceof File) ||
      !file.size ||
      !ACCEPT.has(file.type) ||
      file.size > MAX_SIZE
    ) {
      setMessage("Selecciona un PDF, JPEG, PNG o WebP de hasta 10 MiB.");
      return;
    }
    if (!guideIds.length || !lines[0].description || !(lines[0].quantity > 0)) {
      setMessage(
        "Selecciona guías y completa una línea con cantidad mayor que cero.",
      );
      return;
    }
    setBusy(true);
    setMessage(undefined);
    const invoiceType = String(data.get("invoiceType")) as
      "PRODUCT" | "SERVICE";
    const proposal: InvoiceExtractionPayload = {
      invoice_number: String(data.get("invoiceNumber")),
      invoice_date: String(data.get("invoiceDate")),
      currency: String(data.get("currency")).toUpperCase(),
      subtotal: Number(data.get("subtotal")),
      total: Number(data.get("total")),
      invoice_type: invoiceType,
      lines,
    };
    const prepared = await prepareInvoiceUpload({
      projectId: detail.projectId,
      batchId: detail.id,
      invoiceType,
      invoiceNumber: proposal.invoice_number,
      invoiceDate: proposal.invoice_date,
      currency: proposal.currency,
      subtotal: proposal.subtotal,
      total: proposal.total,
      guideIds,
      lines,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      replacesInvoiceId: replacement?.id,
    });
    if (prepared.status === "error") {
      setBusy(false);
      setMessage(prepared.message);
      return;
    }
    const uploaded = await createClient()
      .storage.from(prepared.upload.bucket)
      .uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, {
        contentType: file.type,
        upsert: false,
      });
    if (uploaded.error) {
      await failInvoiceUpload(
        detail.projectId,
        prepared.upload.documentId,
        prepared.upload.versionId,
        uploaded.error.message,
      );
      setBusy(false);
      setMessage(
        "No fue posible cargar el archivo. La versión quedó marcada como fallida.",
      );
      return;
    }
    const finalized = await finalizeInvoiceUpload({
      projectId: detail.projectId,
      batchId: detail.id,
      invoiceId: prepared.invoiceId,
      documentId: prepared.upload.documentId,
      versionId: prepared.upload.versionId,
      proposal,
    });
    setBusy(false);
    if (finalized.status === "error") {
      setMessage(finalized.message);
      return;
    }
    router.refresh();
    onClose();
  }

  const selected = new Set(replacement?.guideIds ?? []);
  return (
    <Modal
      title={replacement ? "Cargar refacturación" : "Registrar factura"}
      description="El documento queda privado. La propuesta MANUAL_ASSISTED debe confirmarse antes de conciliar."
      icon={FilePlus2}
      pending={busy}
      onClose={onClose}
    >
      <form onSubmit={submit} className="max-h-[78vh] overflow-y-auto">
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <label className="form-label">Tipo *</label>
            <select
              name="invoiceType"
              defaultValue={replacement?.type ?? "PRODUCT"}
              className="form-input"
            >
              <option value="PRODUCT">Producto</option>
              <option value="SERVICE">Servicio</option>
            </select>
          </div>
          <div>
            <label className="form-label">Número *</label>
            <input name="invoiceNumber" required className="form-input" />
          </div>
          <div>
            <label className="form-label">Fecha *</label>
            <input
              name="invoiceDate"
              type="date"
              required
              defaultValue={detail.accountingPeriod}
              min={detail.accountingPeriod}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Moneda *</label>
            <input
              name="currency"
              required
              maxLength={3}
              defaultValue="GTQ"
              className="form-input uppercase"
            />
          </div>
          <div>
            <label className="form-label">Subtotal *</label>
            <input
              name="subtotal"
              type="number"
              min="0"
              step="0.01"
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Total *</label>
            <input
              name="total"
              type="number"
              min="0.01"
              step="0.01"
              required
              className="form-input"
            />
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="form-label">Guías del mismo proveedor *</legend>
            <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
              {detail.activeRelations.map((guide) => (
                <label
                  key={guide.guideId}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    name="guideIds"
                    value={guide.guideId}
                    type="checkbox"
                    defaultChecked={selected.has(guide.guideId)}
                  />{" "}
                  <span>
                    <strong>{guide.guideNumber}</strong> · {guide.supplierName}{" "}
                    · {formatBatchQuantity(guide.receivedQuantity)}{" "}
                    {guide.unitCode}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="form-label">Código de línea</label>
            <input name="lineCode" className="form-input" />
          </div>
          <div>
            <label className="form-label">Descripción *</label>
            <input name="lineDescription" required className="form-input" />
          </div>
          <div>
            <label className="form-label">Cantidad *</label>
            <input
              name="lineQuantity"
              type="number"
              min="0.001"
              step="0.001"
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Unidad</label>
            <input
              name="lineUnit"
              placeholder="M3"
              className="form-input uppercase"
            />
          </div>
          <div>
            <label className="form-label">Precio unitario</label>
            <input
              name="lineUnitPrice"
              type="number"
              min="0"
              step="0.01"
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Total de línea</label>
            <input
              name="lineTotal"
              type="number"
              min="0"
              step="0.01"
              className="form-input"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="form-label">PDF o imagen *</label>
            <input
              name="file"
              type="file"
              required
              accept={[...ACCEPT].join(",")}
              className="form-input"
            />
          </div>
          {replacement && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/35 dark:text-amber-200 sm:col-span-2">
              Reemplaza la factura {replacement.number}. La anterior solo será
              SUPERSEDED cuando la nueva concilie correctamente.
            </p>
          )}
          {message && (
            <p
              role="alert"
              className="rounded-lg bg-destructive-soft p-3 text-sm text-destructive sm:col-span-2"
            >
              {message}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-border p-4">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy && <LoaderCircle className="size-4 animate-spin" />} Registrar
            y cargar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ExtractionDialog({
  detail,
  invoice,
  onClose,
}: {
  detail: BatchDetail;
  invoice: BatchInvoice;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string>();
  const line = invoice.lines[0];
  useGlobalPending(
    busy,
    "Confirmando extracción…",
    "Aplicando los datos verificados al registro de factura.",
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const lines = parseLine(form);
    const changed =
      String(data.get("invoiceNumber")) !== invoice.number ||
      String(data.get("invoiceDate")) !== invoice.date ||
      String(data.get("currency")).toUpperCase() !== invoice.currency ||
      Number(data.get("subtotal")) !== invoice.subtotal ||
      Number(data.get("total")) !== invoice.total ||
      JSON.stringify(lines) !==
        JSON.stringify(
          invoice.lines.map((row) => ({
            code: row.code || undefined,
            description: row.description,
            quantity: row.quantity,
            unit_code: row.unitCode || undefined,
            unit_price: row.unitPrice || undefined,
            line_total: row.lineTotal || undefined,
          })),
        );
    if (
      changed &&
      (!data.get("correctionReasonId") ||
        !String(data.get("correctionNotes")).trim())
    ) {
      setMessage("Los cambios requieren motivo y explicación.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    const result = await confirmInvoiceExtraction({
      projectId: detail.projectId,
      batchId: detail.id,
      extractionId: invoice.extractionId!,
      invoiceNumber: String(data.get("invoiceNumber")),
      invoiceDate: String(data.get("invoiceDate")),
      currency: String(data.get("currency")),
      subtotal: Number(data.get("subtotal")),
      total: Number(data.get("total")),
      lines,
      correctionReasonId: changed
        ? String(data.get("correctionReasonId"))
        : undefined,
      correctionNotes: changed
        ? String(data.get("correctionNotes"))
        : undefined,
    });
    setBusy(false);
    if (result.status === "error") {
      setMessage(result.message);
      return;
    }
    router.refresh();
    onClose();
  }
  return (
    <Modal
      title="Revisar extracción"
      description="Confirma la propuesta o corrígela con trazabilidad obligatoria."
      icon={FileCheck2}
      pending={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          <div>
            <label className="form-label">Número</label>
            <input
              name="invoiceNumber"
              defaultValue={invoice.number}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Fecha</label>
            <input
              name="invoiceDate"
              type="date"
              defaultValue={invoice.date}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Moneda</label>
            <input
              name="currency"
              defaultValue={invoice.currency}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Subtotal</label>
            <input
              name="subtotal"
              type="number"
              step="0.01"
              defaultValue={invoice.subtotal}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Total</label>
            <input
              name="total"
              type="number"
              step="0.01"
              defaultValue={invoice.total}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Código línea</label>
            <input
              name="lineCode"
              defaultValue={line?.code ?? ""}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Descripción</label>
            <input
              name="lineDescription"
              defaultValue={line?.description}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Cantidad</label>
            <input
              name="lineQuantity"
              type="number"
              step="0.001"
              defaultValue={line?.quantity}
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Unidad</label>
            <input
              name="lineUnit"
              defaultValue={line?.unitCode ?? ""}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Precio unitario</label>
            <input
              name="lineUnitPrice"
              type="number"
              step="0.01"
              defaultValue={line?.unitPrice ?? ""}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Total línea</label>
            <input
              name="lineTotal"
              type="number"
              step="0.01"
              defaultValue={line?.lineTotal ?? ""}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Motivo si corriges</label>
            <select name="correctionReasonId" className="form-input">
              <option value="">Sin corrección</option>
              {detail.correctionReasons.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="form-label">Explicación de corrección</label>
            <textarea name="correctionNotes" rows={3} className="form-input" />
          </div>
          {message && (
            <p className="bg-destructive-soft p-3 text-sm text-destructive sm:col-span-2">
              {message}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-border p-4">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Confirmar datos
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InvoiceWorkspace({
  detail,
  permissions,
}: {
  detail: BatchDetail;
  permissions: BatchPermissions;
}) {
  const router = useRouter();
  const [upload, setUpload] = useState<BatchInvoice | "new" | null>(null),
    [review, setReview] = useState<BatchInvoice | null>(null),
    [busyId, setBusyId] = useState<string>(),
    [message, setMessage] = useState<string>();
  useGlobalPending(
    Boolean(busyId),
    "Procesando factura…",
    "Aplicando el contrato de conciliación del lote.",
  );
  const cards = useMemo(
    () => [
      ["Facturas", detail.invoiceSummary.total],
      ["Pendientes", detail.invoiceSummary.pending],
      ["Aprobadas/Match", detail.invoiceSummary.approved],
      ["Refacturación", detail.invoiceSummary.reinvoicing],
    ],
    [detail.invoiceSummary],
  );
  async function reconcile(invoice: BatchInvoice) {
    setBusyId(invoice.id);
    setMessage(undefined);
    const result = await reconcileInvoice(
      detail.projectId,
      detail.id,
      invoice.id,
    );
    setBusyId(undefined);
    if (result.status === "error") setMessage(result.message);
    else router.refresh();
  }
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Facturas y conciliación</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            Producto usa coincidencia exacta de cantidad (tolerancia 0). Servicio
            conserva revisión manual.
          </p>
        </div>
        {permissions.canCreateInvoice && (
          <button
            className="primary-button gap-2"
            onClick={() => setUpload("new")}
          >
            <FilePlus2 className="size-4" /> Registrar factura
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] uppercase text-foreground-muted">
              {label}
            </p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-foreground-muted">
        Guías sin factura de producto:{" "}
        <strong>{detail.invoiceSummary.guidesWithoutProduct}</strong> · Sin
        Sin factura de servicio: <strong>{detail.invoiceSummary.guidesWithoutService}</strong>.
        La ausencia de una factura de servicio no se interpreta como obligación.
      </p>
      {message && (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft p-3 text-sm text-destructive"
        >
          {message}
        </p>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        {detail.invoices.map((invoice) => (
          <article
            key={invoice.id}
            className="rounded-xl border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap gap-2">
                  <strong>
                    {formatStatusLabel(invoice.type)} · {invoice.number}
                  </strong>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold ${invoiceTone(invoice.status)}`}
                  >
                    {formatStatusLabel(invoice.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-foreground-muted">
                  {invoice.supplierName} · {formatBatchDate(invoice.date)} ·{" "}
                  {amount(invoice.total, invoice.currency)}
                </p>
              </div>
              {invoice.documentId && invoice.fileName && (
                <DocumentActions projectId={detail.projectId} documentId={invoice.documentId} fileName={invoice.fileName} mimeType="application/pdf" getSignedUrl={getInvoiceDownloadUrl} compact />
              )}
            </div>
            <p className="mt-3 text-xs">
              Guías: {invoice.guideNumbers.join(", ") || "—"}
            </p>
            {invoice.type === "PRODUCT" && (
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/35 p-3 text-xs">
                <div>
                  <span className="text-foreground-muted">Físico</span>
                  <p className="font-semibold">
                    {formatBatchQuantity(invoice.guideQuantity)}{" "}
                    {invoice.unitCode ?? ""}
                  </p>
                </div>
                <div>
                  <span className="text-foreground-muted">Factura</span>
                  <p className="font-semibold">
                    {formatBatchQuantity(invoice.invoiceQuantity)}{" "}
                    {invoice.unitCode ?? ""}
                  </p>
                </div>
                <div>
                  <span className="text-foreground-muted">Diferencia</span>
                  <p
                    className={
                      invoice.quantityMatch
                        ? "font-semibold text-success"
                        : "font-semibold text-destructive"
                    }
                  >
                    {invoice.difference === null
                      ? "UM no comparable"
                      : formatBatchQuantity(invoice.difference)}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {permissions.canMatchInvoice &&
                invoice.extractionStatus === "PENDING" && (
                  <button
                    className="secondary-button text-xs"
                    onClick={() => setReview(invoice)}
                  >
                    Revisar extracción
                  </button>
                )}
              {permissions.canMatchInvoice &&
                ["CONFIRMED", "CORRECTED"].includes(
                  invoice.extractionStatus ?? "",
                ) &&
                ["UNDER_REVIEW", "MATCHED", "REINVOICING"].includes(
                  invoice.status,
                ) && (
                  <button
                    className="primary-button text-xs"
                    disabled={busyId === invoice.id}
                    onClick={() => void reconcile(invoice)}
                  >
                    <RefreshCcw className="size-3.5" /> Conciliar
                  </button>
                )}
              {permissions.canCreateInvoice &&
                invoice.status === "REINVOICING" && (
                  <button
                    className="secondary-button text-xs"
                    onClick={() => setUpload(invoice)}
                  >
                    Cargar refacturación
                  </button>
                )}
            </div>
            {invoice.replacesInvoiceId && (
              <p className="mt-3 text-[11px] text-foreground-muted">
                Reemplaza: {invoice.replacesInvoiceId}
              </p>
            )}
            {invoice.replacedByInvoiceId && (
              <p className="mt-3 text-[11px] text-foreground-muted">
                Reemplazada por: {invoice.replacedByInvoiceId}
              </p>
            )}
          </article>
        ))}
        {!detail.invoices.length && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground-muted xl:col-span-2">
            Todavía no hay facturas vinculadas a las guías activas.
          </p>
        )}
      </div>
      {upload && (
        <InvoiceUploadDialog
          detail={detail}
          replacement={upload === "new" ? null : upload}
          onClose={() => setUpload(null)}
        />
      )}
      {review && (
        <ExtractionDialog
          detail={detail}
          invoice={review}
          onClose={() => setReview(null)}
        />
      )}
    </section>
  );
}
