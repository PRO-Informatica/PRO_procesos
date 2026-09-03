"use client";

import {
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  FilePlus2,
  LoaderCircle,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { DocumentActions } from "@/components/documents/document-preview-dialog";
import { MotionPage } from "@/components/motion/motion-page";
import { getDocumentDownloadUrl } from "@/features/dispatches/actions";
import { createClient } from "@/lib/supabase/client";
import { formatStatusLabel } from "@/lib/status-labels";

import {
  confirmInvoiceExtraction,
  confirmMixtoListoInvoice,
  discardMixtoListoInvoiceIntake,
  failMixtoListoInvoiceUpload,
  failInvoiceUpload,
  finalizeOrderServiceInvoiceUpload,
  finalizeAndExtractMixtoListoInvoice,
  getInvoiceDownloadUrl,
  inspectMixtoListoInvoicePdf,
  prepareMixtoListoInvoiceUpload,
  prepareOrderServiceInvoiceUpload,
  requestOrderProductReinvoicing,
  startOrderValidation,
} from "../actions";
import { formatBatchDate, formatBatchQuantity } from "../formatters";
import { orderNumberFromMixtoListoPca } from "../mixto-listo-parser";
import type {
  BatchInvoice,
  BatchPermissions,
  InvoiceUploadLine,
  InvoiceType,
  MixtoListoExtractionPreview,
  MixtoListoInvoiceLine,
  ReconciliationOrderDetail,
} from "../types";
import { Modal } from "./batch-dialogs";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MIXTO_REASON_CODES = new Set([
  "QUANTITY_DETECTION_INCORRECT",
  "UNIT_DETECTION_INCORRECT",
  "PRODUCT_CODE_DETECTION_INCORRECT",
  "DESCRIPTION_DETECTION_INCORRECT",
  "PCA_DETECTION_INCORRECT",
  "FIELD_NOT_DETECTED",
  "OTHER",
]);

type DraftLine = MixtoListoInvoiceLine & { id: string };

function draftLine(line?: Partial<MixtoListoInvoiceLine>): DraftLine {
  return {
    id: crypto.randomUUID(),
    quantity: line?.quantity ?? 0,
    unit_code: line?.unit_code ?? "",
    code: line?.code ?? "",
    description: line?.description ?? "",
  };
}

function statusTone(status: string) {
  if (["MATCHED", "CLOSED", "COMPLETED"].includes(status))
    return "bg-success-soft text-success";
  if (
    [
      "WITH_DIFFERENCES",
      "REQUIRES_REVIEW",
      "ORDER_MISMATCH",
      "REINVOICING",
    ].includes(status)
  )
    return "bg-destructive-soft text-destructive";
  return "bg-muted text-foreground-muted";
}

function UploadDialog({
  detail,
  invoiceType,
  replacement,
  initialPreview,
  canConfirm,
  onClose,
}: {
  detail: ReconciliationOrderDetail;
  invoiceType: InvoiceType;
  replacement: BatchInvoice | null;
  initialPreview?: MixtoListoExtractionPreview | null;
  canConfirm: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [preview, setPreview] = useState<MixtoListoExtractionPreview | null>(
    initialPreview ?? null,
  );
  const [editing, setEditing] = useState(false);
  const [pca, setPca] = useState(initialPreview?.pcaOriginal ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    () => initialPreview?.lines.map((line) => draftLine(line)) ?? [],
  );
  const [reasonId, setReasonId] = useState("");
  const [notes, setNotes] = useState("");
  const reasons = detail.correctionReasons.filter((reason) =>
    MIXTO_REASON_CODES.has(reason.code),
  );
  const selectedReason = reasons.find((reason) => reason.id === reasonId);
  const detectedOrder = orderNumberFromMixtoListoPca(pca);
  const orderMismatch = Boolean(
    detectedOrder && detectedOrder !== detail.orderNumber,
  );
  const incomplete =
    !pca.trim() ||
    !lines.length ||
    lines.some(
      (line) =>
        !(line.quantity > 0) ||
        !line.unit_code.trim() ||
        !line.code.trim() ||
        !line.description.trim(),
    );
  useGlobalPending(
    busy,
    preview
      ? "Confirmando factura…"
      : invoiceType === "SERVICE"
        ? "Guardando factura de servicio…"
        : "Extrayendo factura Mixto Listo…",
    preview
      ? "Validando nuevamente el PCA y asociando la factura al Pedido."
      : "Leyendo el PDF y detectando PCA, Pedido y líneas.",
  );

  function loadPreview(value: MixtoListoExtractionPreview) {
    setPreview(value);
    setPca(value.pcaOriginal ?? "");
    setLines(value.lines.map((line) => draftLine(line)));
    setEditing(false);
    setReasonId("");
    setNotes("");
    setMessage(undefined);
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.type.toLowerCase() !== "application/pdf" ||
      !file.name.toLowerCase().endsWith(".pdf") ||
      file.size > MAX_PDF_BYTES
    ) {
      setMessage("Selecciona un archivo PDF de hasta 10 MiB.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    const inspectionData = new FormData();
    inspectionData.set("file", file);
    const inspected = await inspectMixtoListoInvoicePdf(
      detail.projectId,
      detail.id,
      inspectionData,
    );
    if (inspected.status === "error") {
      setBusy(false);
      setMessage(inspected.message);
      return;
    }
    if (
      invoiceType === "PRODUCT" &&
      inspected.metadata.detectedOrderNumber &&
      inspected.metadata.detectedOrderNumber !== detail.orderNumber
    ) {
      setBusy(false);
      setMessage(
        `La factura cargada corresponde al Pedido ${inspected.metadata.detectedOrderNumber} y no al Pedido ${detail.orderNumber}. Carga la factura correcta.`,
      );
      return;
    }
    if (invoiceType === "SERVICE") {
      const prepared = await prepareOrderServiceInvoiceUpload({
        projectId: detail.projectId,
        batchId: detail.batchId,
        orderId: detail.id,
        invoiceNumber: inspected.metadata.invoiceNumber,
        invoiceDate: inspected.metadata.invoiceDate,
        currency: inspected.metadata.currency,
        subtotal: inspected.metadata.subtotal,
        total: inspected.metadata.total,
        fileName: file.name,
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
          contentType: "application/pdf",
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
        setMessage("Falló la carga privada; la versión se marcó como fallida.");
        return;
      }
      const finalized = await finalizeOrderServiceInvoiceUpload({
        projectId: detail.projectId,
        batchId: detail.batchId,
        orderId: detail.id,
        invoiceId: prepared.invoiceId,
        documentId: prepared.upload.documentId,
        versionId: prepared.upload.versionId,
      });
      setBusy(false);
      if (finalized.status === "error") {
        setMessage(finalized.message);
        return;
      }
      router.refresh();
      onClose();
      return;
    }
    const prepared = await prepareMixtoListoInvoiceUpload({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
      invoiceType: "PRODUCT",
      invoiceNumber: inspected.metadata.invoiceNumber,
      invoiceDate: inspected.metadata.invoiceDate,
      currency: inspected.metadata.currency,
      subtotal: inspected.metadata.subtotal,
      total: inspected.metadata.total,
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
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploaded.error) {
      await failMixtoListoInvoiceUpload({
        projectId: detail.projectId,
        intakeId: prepared.intakeId,
        documentId: prepared.upload.documentId,
        versionId: prepared.upload.versionId,
        reason: uploaded.error.message,
      });
      setBusy(false);
      setMessage("Falló la carga privada; la versión se marcó como fallida.");
      return;
    }
    const extracted = await finalizeAndExtractMixtoListoInvoice({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
      intakeId: prepared.intakeId,
      documentId: prepared.upload.documentId,
      versionId: prepared.upload.versionId,
    });
    setBusy(false);
    if (extracted.status === "error") {
      setMessage(extracted.message);
      return;
    }
    loadPreview(extracted.preview);
  }

  function updateLine(
    id: string,
    field: keyof MixtoListoInvoiceLine,
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.id === id
          ? { ...line, [field]: field === "quantity" ? Number(value) : value }
          : line,
      ),
    );
  }

  async function confirm() {
    if (!preview || !canConfirm) return;
    const canonicalLines = lines.map(
      ({ quantity, unit_code, code, description }) => ({
        quantity,
        unit_code: unit_code.trim().toUpperCase().replace("³", "3"),
        code: code.trim().toUpperCase(),
        description: description.trim(),
      }),
    );
    const changed =
      pca.trim().toUpperCase() !== (preview.pcaOriginal ?? "") ||
      JSON.stringify(canonicalLines) !== JSON.stringify(preview.lines);
    if (incomplete) {
      setMessage("Completa PCA, cantidad, medida, código y descripción.");
      return;
    }
    if (!detectedOrder) {
      setMessage(
        "El PCA debe tener el formato PCA-fecha-pedido, por ejemplo PCA-14082026-0047.",
      );
      return;
    }
    if (orderMismatch) {
      setMessage(
        `La factura cargada corresponde al Pedido ${detectedOrder} y no al Pedido ${detail.orderNumber}. Carga la factura correcta.`,
      );
      return;
    }
    if (editing && !changed) {
      setMessage(
        "Modifica al menos un valor detectado o descarta la corrección.",
      );
      return;
    }
    if (changed && !reasonId) {
      setMessage("Selecciona el motivo de la corrección de extracción.");
      return;
    }
    if (changed && selectedReason?.code === "OTHER" && !notes.trim()) {
      setMessage("Describe la corrección cuando seleccionas Otro.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    const result = await confirmMixtoListoInvoice({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
      intakeId: preview.intakeId,
      pcaOriginal: pca,
      lines: canonicalLines,
      correctionReasonId: changed ? reasonId : undefined,
      correctionNotes: changed ? notes : undefined,
    });
    setBusy(false);
    if (result.status === "error") {
      setMessage(result.message);
      return;
    }
    router.refresh();
    onClose();
  }

  if (!preview)
    return (
      <Modal
        title={
          replacement
            ? `Refacturar ${replacement.number}`
            : `Factura ${formatStatusLabel(invoiceType)} · Pedido ${detail.orderNumber}`
        }
        description={
          invoiceType === "SERVICE"
            ? "Carga únicamente el PDF. Se guardará como documento privado sin extracción ni conciliación de cantidades."
            : "Carga únicamente el PDF. La factura se creará después de validar la extracción y el PCA."
        }
        icon={FilePlus2}
        pending={busy}
        onClose={onClose}
      >
        <form onSubmit={upload}>
          <div className="max-h-[72vh] overflow-y-auto p-5">
            <label>
              <span className="form-label">Factura PDF *</span>
              <input
                name="file"
                type="file"
                required
                accept="application/pdf,.pdf"
                className="form-input"
              />
              <span className="mt-1 block text-xs text-foreground-muted">
                PDF {invoiceType === "PRODUCT" ? "Mixto Listo" : "de servicio"},
                máximo 10 MiB. No se aceptan imágenes.
              </span>
            </label>
            {replacement && (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Esta factura reemplazará {replacement.number}; la histórica se
                conservará.
              </p>
            )}
            {message && (
              <p
                role="alert"
                className="sm:col-span-2 rounded-lg bg-destructive-soft p-3 text-sm text-destructive"
              >
                {message}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={onClose}
              className="secondary-button"
            >
              Cancelar
            </button>
            <button disabled={busy} className="primary-button">
              {busy && <LoaderCircle className="size-4 animate-spin" />}{" "}
              {invoiceType === "SERVICE" ? "Guardar factura" : "Extraer datos"}
            </button>
          </div>
        </form>
      </Modal>
    );

  return (
    <Modal
      title={`Preview · Pedido ${detail.orderNumber}`}
      description="Datos extraídos del PDF Mixto Listo. El Pedido se deriva del PCA y no puede editarse directamente."
      icon={FileCheck2}
      pending={busy}
      onClose={onClose}
    >
      <div className="max-h-[78vh] overflow-y-auto">
        <div className="space-y-5 p-5">
          {orderMismatch && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive"
            >
              <strong>Pedido no coincide.</strong>
              <p className="mt-1">
                La factura cargada corresponde al Pedido {detectedOrder} y no al
                Pedido {detail.orderNumber}. Carga la factura correcta.
              </p>
            </div>
          )}
          {!detectedOrder && (
            <div
              role="alert"
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              No se detectó un PCA válido. Usa “Corregir extracción” si el PDF
              sí contiene el dato.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-xs uppercase text-foreground-muted">
                Pedido detectado
              </p>
              <p className="mt-1 text-xl font-semibold">
                {detectedOrder ?? "No detectado"}
              </p>
            </div>
            <label className="rounded-xl bg-muted/40 p-4">
              <span className="text-xs uppercase text-foreground-muted">
                PCA
              </span>
              {editing ? (
                <input
                  value={pca}
                  onChange={(event) => setPca(event.target.value.toUpperCase())}
                  className="form-input mt-2 uppercase"
                />
              ) : (
                <p className="mt-1 font-semibold">{pca || "No detectado"}</p>
              )}
            </label>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-foreground-muted">
              Observaciones
            </p>
            <p className="mt-2 rounded-xl border border-border p-3 text-sm">
              {preview.observationsRaw ?? "No detectadas"}
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-foreground-muted">
                <tr>
                  <th className="p-3">Cantidad</th>
                  <th className="p-3">Medida</th>
                  <th className="p-3">Código</th>
                  <th className="p-3">Descripción</th>
                  {editing && (
                    <th className="p-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line, index) => (
                  <tr key={line.id}>
                    <td className="p-3">
                      {editing ? (
                        <input
                          aria-label={`Cantidad línea ${index + 1}`}
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={line.quantity || ""}
                          onChange={(event) =>
                            updateLine(line.id, "quantity", event.target.value)
                          }
                          className="form-input w-28"
                        />
                      ) : (
                        formatBatchQuantity(line.quantity)
                      )}
                    </td>
                    <td className="p-3">
                      {editing ? (
                        <input
                          aria-label={`Medida línea ${index + 1}`}
                          value={line.unit_code}
                          onChange={(event) =>
                            updateLine(line.id, "unit_code", event.target.value)
                          }
                          className="form-input w-24 uppercase"
                        />
                      ) : (
                        line.unit_code
                      )}
                    </td>
                    <td className="p-3">
                      {editing ? (
                        <input
                          aria-label={`Código línea ${index + 1}`}
                          value={line.code}
                          onChange={(event) =>
                            updateLine(line.id, "code", event.target.value)
                          }
                          className="form-input w-36 uppercase"
                        />
                      ) : (
                        line.code
                      )}
                    </td>
                    <td className="p-3">
                      {editing ? (
                        <input
                          aria-label={`Descripción línea ${index + 1}`}
                          value={line.description}
                          onChange={(event) =>
                            updateLine(
                              line.id,
                              "description",
                              event.target.value,
                            )
                          }
                          className="form-input min-w-64"
                        />
                      ) : (
                        line.description
                      )}
                    </td>
                    {editing && (
                      <td className="p-3">
                        <button
                          type="button"
                          aria-label={`Eliminar línea ${index + 1}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((item) => item.id !== line.id),
                            )
                          }
                          className="secondary-button"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!lines.length && (
                  <tr>
                    <td
                      colSpan={editing ? 5 : 4}
                      className="p-6 text-center text-foreground-muted"
                    >
                      No se detectaron líneas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {editing && (
            <div className="space-y-4">
              <button
                type="button"
                className="secondary-button text-xs"
                onClick={() => setLines((current) => [...current, draftLine()])}
              >
                <Plus className="size-3.5" /> Agregar línea
              </button>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="form-label">Motivo de corrección *</span>
                  <select
                    value={reasonId}
                    onChange={(event) => setReasonId(event.target.value)}
                    className="form-input"
                  >
                    <option value="">Selecciona un motivo</option>
                    {reasons.map((reason) => (
                      <option key={reason.id} value={reason.id}>
                        {reason.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="form-label">
                    Detalle {selectedReason?.code === "OTHER" ? "*" : ""}
                  </span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    className="form-input"
                  />
                </label>
              </div>
            </div>
          )}
          {!canConfirm && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              La extracción quedó guardada. Se requiere invoice.match para
              corregirla o confirmarla.
            </p>
          )}
          {message && (
            <p
              role="alert"
              className="rounded-lg bg-destructive-soft p-3 text-sm text-destructive"
            >
              {message}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
          {orderMismatch && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPreview(null);
                setMessage(undefined);
              }}
            >
              Cargar otra factura
            </button>
          )}
          {canConfirm && !editing && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setEditing(true);
                if (!lines.length) setLines([draftLine()]);
                setMessage(undefined);
              }}
            >
              <Pencil className="size-4" /> Corregir extracción
            </button>
          )}
          {canConfirm && editing && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => loadPreview(preview)}
            >
              Descartar corrección
            </button>
          )}
          {canConfirm && (
            <button
              type="button"
              disabled={busy || orderMismatch || incomplete}
              onClick={() => void confirm()}
              className="primary-button"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}{" "}
              Confirmar factura
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ReviewDialog({
  detail,
  invoice,
  onClose,
}: {
  detail: ReconciliationOrderDetail;
  invoice: BatchInvoice;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const initialLines = JSON.stringify(
    invoice.lines.map((line) => ({
      code: line.code,
      description: line.description,
      quantity: line.quantity,
      unit_code: line.unitCode,
      unit_price: line.unitPrice,
      line_total: line.lineTotal,
    })),
    null,
    2,
  );
  useGlobalPending(
    busy,
    "Verificando extracción…",
    "Guardando la confirmación o corrección con trazabilidad.",
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let parsedLines: InvoiceUploadLine[];
    try {
      parsedLines = JSON.parse(String(data.get("lines")));
    } catch {
      setMessage("Las líneas deben ser un arreglo JSON válido.");
      return;
    }
    const changed =
      String(data.get("invoiceNumber")) !== invoice.number ||
      String(data.get("invoiceDate")) !== invoice.date ||
      String(data.get("currency")).toUpperCase() !== invoice.currency ||
      Number(data.get("subtotal")) !== invoice.subtotal ||
      Number(data.get("total")) !== invoice.total ||
      JSON.stringify(parsedLines) !== JSON.stringify(JSON.parse(initialLines));
    const reason = String(data.get("reason") || "");
    const notesValue = String(data.get("notes") || "").trim();
    if (changed && (!reason || !notesValue)) {
      setMessage("Toda corrección requiere motivo y explicación.");
      return;
    }
    setBusy(true);
    const result = await confirmInvoiceExtraction({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
      invoiceId: invoice.id,
      orderNumber: detail.orderNumber,
      pcaOriginal: invoice.pcaOriginal ?? undefined,
      extractionId: invoice.extractionId!,
      invoiceNumber: String(data.get("invoiceNumber")),
      invoiceDate: String(data.get("invoiceDate")),
      currency: String(data.get("currency")),
      subtotal: Number(data.get("subtotal")),
      total: Number(data.get("total")),
      lines: parsedLines,
      correctionReasonId: changed ? reason : undefined,
      correctionNotes: changed ? notesValue : undefined,
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
      title={`Revisar extracción histórica · ${invoice.number}`}
      description="Flujo de extracción anterior; conserva su contrato y trazabilidad."
      icon={FileCheck2}
      pending={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid max-h-[72vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          <label>
            <span className="form-label">Número</span>
            <input
              name="invoiceNumber"
              defaultValue={invoice.number}
              required
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Fecha</span>
            <input
              name="invoiceDate"
              type="date"
              defaultValue={invoice.date}
              required
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Moneda</span>
            <input
              name="currency"
              defaultValue={invoice.currency}
              required
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Subtotal</span>
            <input
              name="subtotal"
              type="number"
              step="0.01"
              defaultValue={invoice.subtotal}
              required
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Total</span>
            <input
              name="total"
              type="number"
              step="0.01"
              defaultValue={invoice.total}
              required
              className="form-input"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="form-label">Líneas JSON</span>
            <textarea
              name="lines"
              rows={9}
              defaultValue={initialLines}
              className="form-input font-mono text-xs"
            />
          </label>
          <label>
            <span className="form-label">Motivo si corriges</span>
            <select name="reason" className="form-input">
              <option value="">Sin corrección</option>
              {detail.correctionReasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="form-label">Explicación de la corrección</span>
            <textarea name="notes" rows={3} className="form-input" />
          </label>
          {message && (
            <p
              role="alert"
              className="sm:col-span-2 rounded-lg bg-destructive-soft p-3 text-sm text-destructive"
            >
              {message}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
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

function SummaryCard({
  label,
  values,
  tone = "default",
}: {
  label: string;
  values: string[];
  tone?: "default" | "warning" | "success";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/25 p-3 sm:p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <div
        className={`mt-2 space-y-1 text-lg font-semibold ${tone === "warning" ? "text-amber-700 dark:text-amber-300" : tone === "success" ? "text-success" : "text-foreground"}`}
      >
        {values.length ? (
          values.map((value, index) => (
            <p key={`${value}-${index}`} className="break-words">
              {value}
            </p>
          ))
        ) : (
          <p>0</p>
        )}
      </div>
    </div>
  );
}

function isGuideAlignedPartial(
  line: ReconciliationOrderDetail["lines"][number],
) {
  if (line.invoicedTotal <= 0 || line.invoicedTotal >= line.dispatchedTotal) {
    return false;
  }
  const quantityByGuide = new Map<string, number>();
  for (const contribution of line.guideContributions) {
    quantityByGuide.set(
      contribution.guideId,
      (quantityByGuide.get(contribution.guideId) ?? 0) + contribution.quantity,
    );
  }
  const target = Math.round(line.invoicedTotal * 1000);
  let possible = new Set([0]);
  for (const quantity of quantityByGuide.values()) {
    const scaled = Math.round(quantity * 1000);
    const next = new Set(possible);
    for (const subtotal of possible) {
      if (subtotal + scaled <= target) next.add(subtotal + scaled);
    }
    possible = next;
  }
  return possible.has(target);
}

export function OrderDetailView({
  detail,
  permissions,
}: {
  detail: ReconciliationOrderDetail;
  permissions: BatchPermissions;
}) {
  const router = useRouter();
  const [upload, setUpload] = useState<{
    type: InvoiceType;
    replacement: BatchInvoice | null;
  } | null>(null);
  const [pendingPreview, setPendingPreview] =
    useState<MixtoListoExtractionPreview | null>(null);
  const [review, setReview] = useState<BatchInvoice | null>(null);
  const [discardIntake, setDiscardIntake] = useState<{
    intakeId: string;
    invoiceNumber: string;
  } | null>(null);
  const [discardedIntakeIds, setDiscardedIntakeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useGlobalPending(
    busy,
    discardIntake
      ? "Eliminando factura pendiente…"
      : "Actualizando conciliación…",
    discardIntake
      ? "Quitando el intento del flujo y conservando su auditoría."
      : "Aplicando los contratos del Pedido.",
  );
  async function startProductInvoice() {
    setBusy(true);
    const result = await startOrderValidation({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
    });
    setBusy(false);
    if (result.status === "error") setMessage(result.message);
    else {
      setMessage(undefined);
      setPendingPreview(null);
      setUpload({ type: "PRODUCT", replacement: null });
      router.refresh();
    }
  }
  async function requestReinvoicing(invoice: BatchInvoice) {
    setBusy(true);
    const result = await requestOrderProductReinvoicing({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
      invoiceId: invoice.id,
    });
    setBusy(false);
    if (result.status === "error") setMessage(result.message);
    else router.refresh();
  }
  async function discardPendingInvoice() {
    if (!discardIntake) return;
    setBusy(true);
    setMessage(undefined);
    const result = await discardMixtoListoInvoiceIntake({
      projectId: detail.projectId,
      batchId: detail.batchId,
      orderId: detail.id,
      intakeId: discardIntake.intakeId,
    });
    setBusy(false);
    if (result.status === "error") {
      setMessage(result.message);
      return;
    }
    const discardedId = discardIntake.intakeId;
    setDiscardedIntakeIds((current) => {
      const next = new Set(current);
      next.add(discardedId);
      return next;
    });
    setDiscardIntake(null);
    router.refresh();
  }
  const replacementSource = detail.invoices.find(
    (invoice) => invoice.type === "PRODUCT" && invoice.status === "REINVOICING",
  );
  const reinvoicingCandidate = detail.invoices.find(
    (invoice) =>
      invoice.type === "PRODUCT" &&
      !invoice.replacedByInvoiceId &&
      !["SUPERSEDED", "CANCELLED", "REINVOICING"].includes(invoice.status),
  );
  const quantitySummary = detail.lines.length
    ? detail.lines.map((line) => ({
        unitCode: line.unitCode,
        dispatched: line.dispatchedTotal,
        invoiced: line.invoicedTotal,
        difference: line.difference,
      }))
    : detail.quantitiesByUnit.map((row) => ({
        unitCode: row.unitCode,
        dispatched: row.quantity,
        invoiced: 0,
        difference: -row.quantity,
      }));
  const currentProductInvoices = detail.invoices.filter(
    (invoice) =>
      invoice.type === "PRODUCT" &&
      !invoice.replacedByInvoiceId &&
      !["SUPERSEDED", "CANCELLED"].includes(invoice.status),
  );
  const hasOverage = quantitySummary.some((row) => row.difference > 0);
  const hasShortfall = quantitySummary.some((row) => row.difference < 0);
  const hasUnalignedShortfall = detail.lines.some(
    (line) => line.difference < 0 && !isGuideAlignedPartial(line),
  );
  const pendingValues = quantitySummary.map((row) => ({
    unitCode: row.unitCode,
    quantity: Math.max(-row.difference, 0),
  }));
  const visiblePendingIntakes = detail.pendingMixtoListoIntakes.filter(
    (intake) => !discardedIntakeIds.has(intake.intakeId),
  );
  const screenState = visiblePendingIntakes.length
    ? "PENDING_REVIEW"
    : detail.effectiveStatus === "COMPLETED"
      ? "COMPLETED"
      : replacementSource
        ? "REINVOICING"
        : !currentProductInvoices.length
          ? "NO_INVOICE"
          : hasOverage ||
              hasUnalignedShortfall ||
              detail.reconciliationStatus === "REQUIRES_REVIEW"
            ? "MISMATCH"
            : hasShortfall
              ? "PARTIAL"
              : "MISMATCH";
  const humanStatus = {
    PENDING_REVIEW: "Factura pendiente de revisión",
    COMPLETED: "Completado",
    REINVOICING: "En refacturación",
    NO_INVOICE: "Pendiente de factura",
    MISMATCH: "Requiere corrección",
    PARTIAL: "Facturación parcial",
  }[screenState];
  const firstPendingIntake = visiblePendingIntakes[0] ?? null;
  const pendingText = pendingValues
    .filter((row) => row.quantity > 0)
    .map((row) => `${formatBatchQuantity(row.quantity)} ${row.unitCode ?? ""}`)
    .join(" y ");
  function openInvoiceUpload(
    type: InvoiceType,
    replacement: BatchInvoice | null = null,
  ) {
    setPendingPreview(null);
    setUpload({ type, replacement });
  }
  return (
    <MotionPage className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <Link
        href={`/batches/${detail.batchId}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver al lote
      </Link>
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
            Pedido {detail.orderNumber}
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold sm:text-3xl">
                {detail.supplierName}
              </h1>
              <p className="mt-1 text-sm text-foreground-muted">
                {detail.batchCode} · {detail.guideCount}{" "}
                {detail.guideCount === 1 ? "guía" : "guías"} ·{" "}
                {detail.invoiceCount}{" "}
                {detail.invoiceCount === 1 ? "factura" : "facturas"}
              </p>
            </div>
            <span
              className={`w-fit rounded-full px-3 py-1.5 text-sm font-semibold ${screenState === "COMPLETED" ? statusTone("COMPLETED") : screenState === "REINVOICING" || screenState === "MISMATCH" ? statusTone("REINVOICING") : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"}`}
            >
              {humanStatus}
            </span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <SummaryCard
            label="Despachado"
            values={quantitySummary.map(
              (row) =>
                `${formatBatchQuantity(row.dispatched)} ${row.unitCode ?? ""}`,
            )}
          />
          <SummaryCard
            label="Facturado"
            values={quantitySummary.map(
              (row) =>
                `${formatBatchQuantity(row.invoiced)} ${row.unitCode ?? ""}`,
            )}
          />
          <SummaryCard
            label="Pendiente"
            values={pendingValues.map(
              (row) =>
                `${formatBatchQuantity(row.quantity)} ${row.unitCode ?? ""}`,
            )}
            tone={hasShortfall ? "warning" : "success"}
          />
        </div>

        <div
          className={`mt-5 rounded-xl border p-4 sm:p-5 ${screenState === "COMPLETED" ? "border-success/30 bg-success-soft" : "border-brand/20 bg-brand-soft/35"}`}
        >
          <div className="flex items-start gap-3">
            {screenState === "COMPLETED" ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
            ) : (
              <FileCheck2 className="mt-0.5 size-5 shrink-0 text-brand-strong" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                {screenState === "COMPLETED"
                  ? "Pedido completado"
                  : "Siguiente paso"}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">
                {screenState === "PENDING_REVIEW" &&
                  "Revisa la factura cargada antes de agregar otra."}
                {screenState === "NO_INVOICE" &&
                  "Carga una factura PRODUCT para comparar lo facturado contra las guías del Pedido."}
                {screenState === "PARTIAL" &&
                  `Aún faltan ${pendingText || "cantidades"} por facturar.`}
                {screenState === "MISMATCH" &&
                  "La cantidad facturada no coincide con la despachada."}
                {screenState === "REINVOICING" &&
                  "Carga la factura corregida para volver a validar el Pedido."}
                {screenState === "COMPLETED" &&
                  "Las cantidades despachadas y facturadas coinciden."}
              </p>
              {message && (
                <p
                  role="alert"
                  className="mt-3 text-sm font-medium text-destructive"
                >
                  {message}
                </p>
              )}
              {screenState !== "COMPLETED" && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {screenState === "PENDING_REVIEW" &&
                    firstPendingIntake &&
                    permissions.canMatchInvoice && (
                      <button
                        className="primary-button justify-center"
                        onClick={() => {
                          setPendingPreview(firstPendingIntake);
                          setUpload({ type: "PRODUCT", replacement: null });
                        }}
                      >
                        Revisar factura pendiente
                      </button>
                    )}
                  {screenState === "NO_INVOICE" &&
                    permissions.canCreateInvoice &&
                    permissions.canMatchInvoice && (
                      <button
                        className="primary-button justify-center"
                        onClick={() => void startProductInvoice()}
                      >
                        <FilePlus2 className="size-4" /> Cargar factura PRODUCT
                      </button>
                    )}
                  {screenState === "PARTIAL" &&
                    permissions.canCreateInvoice && (
                      <button
                        className="primary-button justify-center"
                        onClick={() => openInvoiceUpload("PRODUCT")}
                      >
                        <FilePlus2 className="size-4" /> Agregar factura PRODUCT
                      </button>
                    )}
                  {screenState === "MISMATCH" &&
                    permissions.canMatchInvoice &&
                    reinvoicingCandidate && (
                      <button
                        className="primary-button justify-center"
                        onClick={() =>
                          void requestReinvoicing(reinvoicingCandidate)
                        }
                      >
                        Solicitar refacturación
                      </button>
                    )}
                  {screenState === "REINVOICING" &&
                    permissions.canCreateInvoice &&
                    replacementSource && (
                      <button
                        className="primary-button justify-center"
                        onClick={() =>
                          openInvoiceUpload("PRODUCT", replacementSource)
                        }
                      >
                        <FilePlus2 className="size-4" /> Cargar factura
                        corregida
                      </button>
                    )}
                  {screenState === "PARTIAL" &&
                    permissions.canMatchInvoice &&
                    reinvoicingCandidate && (
                      <button
                        className="secondary-button justify-center"
                        onClick={() =>
                          void requestReinvoicing(reinvoicingCandidate)
                        }
                      >
                        La factura necesita corrección
                      </button>
                    )}
                  {["NO_INVOICE", "PARTIAL", "MISMATCH"].includes(
                    screenState,
                  ) &&
                    permissions.canCreateInvoice && (
                      <button
                        className="secondary-button justify-center"
                        onClick={() => openInvoiceUpload("SERVICE")}
                      >
                        Agregar factura SERVICE
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {visiblePendingIntakes.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h2 className="font-semibold">Facturas pendientes de revisar</h2>
          </div>
          <div className="hidden max-h-72 overflow-auto md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase text-foreground-muted">
                <tr>
                  <th className="px-4 py-3">Factura</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Pedido detectado</th>
                  <th className="px-4 py-3">Cantidad</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visiblePendingIntakes.map((intake) => (
                  <tr key={intake.intakeId}>
                    <td className="px-4 py-3 font-semibold">
                      {intake.invoiceNumber}
                    </td>
                    <td className="px-4 py-3">{intake.invoiceType}</td>
                    <td className="px-4 py-3">
                      {intake.detectedOrderNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {intake.lines
                        .map(
                          (line) =>
                            `${formatBatchQuantity(line.quantity)} ${line.unit_code}`,
                        )
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3">Pendiente</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          className="secondary-button text-xs"
                          onClick={() => {
                            setPendingPreview(intake);
                            setUpload({ type: "PRODUCT", replacement: null });
                          }}
                        >
                          Revisar
                        </button>
                        {permissions.canCreateInvoice && (
                          <button
                            type="button"
                            className="grid size-9 place-items-center rounded-lg border border-destructive/25 text-destructive hover:bg-destructive-soft disabled:opacity-50"
                            onClick={() => {
                              setMessage(undefined);
                              setDiscardIntake({
                                intakeId: intake.intakeId,
                                invoiceNumber: intake.invoiceNumber,
                              });
                            }}
                            aria-label={`Eliminar factura pendiente ${intake.invoiceNumber}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {visiblePendingIntakes.map((intake) => (
              <article key={intake.intakeId} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      Factura {intake.invoiceNumber}
                    </p>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {intake.invoiceType} · Pedido{" "}
                      {intake.detectedOrderNumber ?? "—"}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Pendiente
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  {intake.lines
                    .map(
                      (line) =>
                        `${formatBatchQuantity(line.quantity)} ${line.unit_code}`,
                    )
                    .join(" · ") || "Cantidad no detectada"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className="secondary-button justify-center text-xs"
                    onClick={() => {
                      setPendingPreview(intake);
                      setUpload({ type: "PRODUCT", replacement: null });
                    }}
                  >
                    Revisar factura
                  </button>
                  {permissions.canCreateInvoice && (
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-destructive/25 px-3 text-xs font-semibold text-destructive hover:bg-destructive-soft disabled:opacity-50"
                      onClick={() => {
                        setMessage(undefined);
                        setDiscardIntake({
                          intakeId: intake.intakeId,
                          invoiceNumber: intake.invoiceNumber,
                        });
                      }}
                    >
                      <Trash2 className="size-4" /> Eliminar
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Truck className="size-4 text-brand-strong" /> Guías
          </h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
            {detail.guides.length}
          </span>
        </div>
        <div className="hidden max-h-[30rem] overflow-auto md:block">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="sticky top-0 bg-muted text-xs uppercase text-foreground-muted">
              <tr>
                <th className="px-4 py-3">Guía</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Despachado</th>
                <th className="px-4 py-3">Recibido</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.guides.map((guide) => (
                <tr key={guide.guideId}>
                  <td className="px-4 py-3 font-semibold">
                    {guide.guideNumber}
                  </td>
                  <td className="px-4 py-3">
                    {formatBatchDate(guide.guideDate)}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {formatBatchQuantity(guide.quantity)} {guide.unitCode}
                  </td>
                  <td className="px-4 py-3">
                    {formatBatchQuantity(guide.receivedQuantity)}{" "}
                    {guide.unitCode}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {guide.documents.length
                        ? guide.documents.map((document) => (
                            <span
                              key={document.id}
                              className="inline-flex items-center gap-1.5"
                            >
                              {document.uploadStatus === "UPLOADED"
                                ? "Disponible"
                                : formatStatusLabel(
                                    document.uploadStatus,
                                    "Pendiente",
                                  )}
                              {document.uploadStatus === "UPLOADED" &&
                                document.fileName &&
                                document.mimeType && (
                                  <DocumentActions
                                    projectId={detail.projectId}
                                    documentId={document.id}
                                    fileName={document.fileName}
                                    mimeType={document.mimeType}
                                    getSignedUrl={getDocumentDownloadUrl}
                                    compact
                                  />
                                )}
                            </span>
                          ))
                        : "Sin documento"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dispatches/${guide.dispatchId}`}
                      className="secondary-button text-xs"
                    >
                      Ver despacho
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {detail.guides.map((guide) => (
            <article key={guide.guideId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{guide.guideNumber}</p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {formatBatchDate(guide.guideDate)}
                  </p>
                </div>
                <span className="text-sm font-semibold">
                  {formatBatchQuantity(guide.quantity)} {guide.unitCode}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground-muted">
                Recibido {formatBatchQuantity(guide.receivedQuantity)}{" "}
                {guide.unitCode}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  {guide.documents.map((document) =>
                    document.uploadStatus === "UPLOADED" &&
                    document.fileName &&
                    document.mimeType ? (
                      <DocumentActions
                        key={document.id}
                        projectId={detail.projectId}
                        documentId={document.id}
                        fileName={document.fileName}
                        mimeType={document.mimeType}
                        getSignedUrl={getDocumentDownloadUrl}
                        compact
                      />
                    ) : null,
                  )}
                </div>
                <Link
                  href={`/dispatches/${guide.dispatchId}`}
                  className="secondary-button text-xs"
                >
                  Ver despacho
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <ReceiptText className="size-4 text-brand-strong" /> Facturas
          </h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
            {detail.invoices.length}
          </span>
        </div>
        <div className="hidden max-h-[30rem] overflow-auto md:block">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="sticky top-0 bg-muted text-xs uppercase text-foreground-muted">
              <tr>
                <th className="px-4 py-3">Factura</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Cantidad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-3 font-semibold">{invoice.number}</td>
                  <td className="px-4 py-3">{invoice.type}</td>
                  <td className="px-4 py-3">
                    {invoice.type === "SERVICE"
                      ? "No aplica"
                      : invoice.lines
                          .map(
                            (line) =>
                              `${formatBatchQuantity(line.quantity)} ${line.unitCode ?? ""}`,
                          )
                          .join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {invoice.replacedByInvoiceId
                      ? "Reemplazada"
                      : invoice.extractionStatus === "PENDING"
                        ? "Pendiente de revisión"
                        : detail.effectiveStatus === "COMPLETED" &&
                            invoice.type === "PRODUCT"
                          ? "Conciliada"
                          : formatStatusLabel(invoice.status)}
                  </td>
                  <td className="px-4 py-3">
                    {invoice.fileName ? "PDF" : "Sin documento"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {invoice.documentId && invoice.fileName && (
                        <DocumentActions
                          projectId={detail.projectId}
                          documentId={invoice.documentId}
                          fileName={invoice.fileName}
                          mimeType="application/pdf"
                          getSignedUrl={getInvoiceDownloadUrl}
                          compact
                        />
                      )}
                      {permissions.canMatchInvoice &&
                        invoice.extractionStatus === "PENDING" && (
                          <button
                            className="secondary-button text-xs"
                            onClick={() => setReview(invoice)}
                          >
                            Revisar
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {detail.invoices.map((invoice) => (
            <article key={invoice.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">Factura {invoice.number}</p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {invoice.type} ·{" "}
                    {invoice.replacedByInvoiceId
                      ? "Reemplazada"
                      : invoice.extractionStatus === "PENDING"
                        ? "Pendiente de revisión"
                        : detail.effectiveStatus === "COMPLETED" &&
                            invoice.type === "PRODUCT"
                          ? "Conciliada"
                          : formatStatusLabel(invoice.status)}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {invoice.type === "SERVICE"
                    ? "No aplica"
                    : invoice.lines
                        .map(
                          (line) =>
                            `${formatBatchQuantity(line.quantity)} ${line.unitCode ?? ""}`,
                        )
                        .join(" · ") || "—"}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {invoice.documentId && invoice.fileName && (
                  <DocumentActions
                    projectId={detail.projectId}
                    documentId={invoice.documentId}
                    fileName={invoice.fileName}
                    mimeType="application/pdf"
                    getSignedUrl={getInvoiceDownloadUrl}
                    compact
                  />
                )}
                {permissions.canMatchInvoice &&
                  invoice.extractionStatus === "PENDING" && (
                    <button
                      className="secondary-button text-xs"
                      onClick={() => setReview(invoice)}
                    >
                      Revisar
                    </button>
                  )}
              </div>
            </article>
          ))}
          {!detail.invoices.length && (
            <p className="p-5 text-sm text-foreground-muted">
              Todavía no hay facturas cargadas.
            </p>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-semibold">Conciliación</h2>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-foreground-muted">
              <tr>
                <th className="px-4 py-3">UM</th>
                <th className="px-4 py-3">Despachado</th>
                <th className="px-4 py-3">Facturado</th>
                <th className="px-4 py-3">Diferencia</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quantitySummary.map((row, index) => (
                <tr key={`${row.unitCode}-${index}`}>
                  <td className="px-4 py-3 font-semibold">
                    {row.unitCode ?? "Sin UM"}
                  </td>
                  <td className="px-4 py-3">
                    {formatBatchQuantity(row.dispatched)}
                  </td>
                  <td className="px-4 py-3">
                    {formatBatchQuantity(row.invoiced)}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {formatBatchQuantity(row.difference)}
                  </td>
                  <td className="px-4 py-3">{humanStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {quantitySummary.map((row, index) => (
            <article key={`${row.unitCode}-${index}`} className="p-4">
              <div className="flex items-center justify-between">
                <strong>{row.unitCode ?? "Sin UM"}</strong>
                <span className="text-xs font-semibold">{humanStatus}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Metric
                  label="Despachado"
                  value={row.dispatched}
                  unit={row.unitCode}
                />
                <Metric
                  label="Facturado"
                  value={row.invoiced}
                  unit={row.unitCode}
                />
                <Metric
                  label="Diferencia"
                  value={row.difference}
                  unit={row.unitCode}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <details className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <summary className="cursor-pointer font-semibold">
          Ver detalle técnico
        </summary>
        <p className="mt-2 text-xs text-foreground-muted">
          Códigos, descripciones y aportes documentales. Estos datos son
          informativos y no cambian la comparación por cantidad y UM.
        </p>
        <div className="mt-4 space-y-4">
          {detail.lines.map((line) => (
            <article key={line.id} className="rounded-lg bg-muted/35 p-3">
              <p className="break-words text-sm font-semibold">
                {line.productCode} · {line.productDescription}
              </p>
              <p className="mt-1 text-xs text-foreground-muted">
                {line.unitCode ?? "Sin UM"} · {line.guideCount} guía(s) ·{" "}
                {line.invoiceCount} factura(s)
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Contribution
                  title="Aporte de guías"
                  rows={line.guideContributions.map((item) => ({
                    key: `${item.guideId}-${item.productCode}`,
                    label: item.guideNumber,
                    href: `/dispatches/${item.dispatchId}`,
                    detail: `${item.programmingCode} · ${formatBatchQuantity(item.quantity)} ${item.unitCode}`,
                  }))}
                />
                <Contribution
                  title="Aporte de facturas"
                  rows={line.invoiceContributions.map((item, index) => ({
                    key: `${item.invoiceId}-${index}`,
                    label: `${item.invoiceType} · ${item.invoiceNumber}`,
                    detail: `${item.description} · ${formatBatchQuantity(item.quantity)} ${item.unitCode ?? ""}`,
                  }))}
                />
              </div>
            </article>
          ))}
          {detail.invoices.map((invoice) => (
            <article
              key={invoice.id}
              className="rounded-lg border border-border p-3 text-xs text-foreground-muted"
            >
              <strong className="text-foreground">
                Factura {invoice.number}
              </strong>
              {invoice.pcaOriginal && (
                <p className="mt-1">PCA: {invoice.pcaOriginal}</p>
              )}
              <p className="mt-1">
                Revisión documental:{" "}
                {formatStatusLabel(invoice.extractionStatus, "No aplica")}
              </p>
              {invoice.lines.map((line, index) => (
                <p key={`${invoice.id}-${index}`} className="mt-1 break-words">
                  {line.code ?? "Sin código"} · {line.description} ·{" "}
                  {formatBatchQuantity(line.quantity)} {line.unitCode ?? ""}
                </p>
              ))}
            </article>
          ))}
        </div>
      </details>
      {upload && (
        <UploadDialog
          detail={detail}
          invoiceType={upload.type}
          replacement={upload.replacement}
          initialPreview={pendingPreview}
          canConfirm={permissions.canMatchInvoice}
          onClose={() => {
            setUpload(null);
            setPendingPreview(null);
          }}
        />
      )}
      {review && (
        <ReviewDialog
          detail={detail}
          invoice={review}
          onClose={() => setReview(null)}
        />
      )}
      {discardIntake && (
        <Modal
          title="Eliminar factura pendiente"
          description={`Factura ${discardIntake.invoiceNumber}`}
          icon={Trash2}
          onClose={() => setDiscardIntake(null)}
          pending={busy}
        >
          <div className="p-5 sm:p-6">
            <p className="text-sm text-foreground-muted">
              La factura dejará de aparecer como pendiente y no podrá
              confirmarse. El PDF y la extracción se conservarán únicamente para
              auditoría.
            </p>
            {message && (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-destructive-soft p-3 text-sm text-destructive"
              >
                {message}
              </p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              className="secondary-button justify-center"
              onClick={() => setDiscardIntake(null)}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void discardPendingInvoice()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {busy ? "Eliminando…" : "Eliminar factura"}
            </button>
          </div>
        </Modal>
      )}
    </MotionPage>
  );
}

function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string | null;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-foreground-muted">{label}</p>
      <p className="mt-1 font-semibold">
        {formatBatchQuantity(value)} {unit ?? ""}
      </p>
    </div>
  );
}
function Contribution({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; detail: string; href?: string }>;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-foreground-muted">
        {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="rounded-lg bg-muted/40 p-3 text-sm">
            {row.href ? (
              <Link
                href={row.href}
                className="font-semibold text-brand-strong hover:underline"
              >
                {row.label}
              </Link>
            ) : (
              <strong>{row.label}</strong>
            )}
            <p className="mt-1 text-xs text-foreground-muted">{row.detail}</p>
          </li>
        ))}
        {!rows.length && (
          <li className="text-xs text-foreground-muted">Sin aportes.</li>
        )}
      </ul>
    </div>
  );
}
