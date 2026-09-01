"use client";

import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  FileCheck2,
  FilePlus2,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  Trash2,
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
    ["WITH_DIFFERENCES", "REQUIRES_REVIEW", "ORDER_MISMATCH", "REINVOICING"].includes(status)
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
                PDF {invoiceType === "PRODUCT" ? "Mixto Listo" : "de servicio"}, máximo 10 MiB. No se aceptan imágenes.
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
              {busy && <LoaderCircle className="size-4 animate-spin" />} {invoiceType === "SERVICE" ? "Guardar factura" : "Extraer datos"}
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

function InvoiceTypeDialog({
  orderNumber,
  onSelect,
  onClose,
}: {
  orderNumber: string;
  onSelect: (type: InvoiceType) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Validar Pedido ${orderNumber}`}
      description="Elige el tipo de factura que deseas cargar."
      icon={FilePlus2}
      pending={false}
      onClose={onClose}
    >
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <button
          type="button"
          className="rounded-xl border border-border p-5 text-left transition hover:border-brand hover:bg-brand-soft/40"
          onClick={() => onSelect("PRODUCT")}
        >
          <Package className="size-6 text-brand-strong" />
          <strong className="mt-3 block">PRODUCT</strong>
          <span className="mt-1 block text-sm text-foreground-muted">
            Extrae PCA y líneas, permite corregir y concilia contra las guías.
          </span>
        </button>
        <button
          type="button"
          className="rounded-xl border border-border p-5 text-left transition hover:border-brand hover:bg-brand-soft/40"
          onClick={() => onSelect("SERVICE")}
        >
          <BriefcaseBusiness className="size-6 text-brand-strong" />
          <strong className="mt-3 block">SERVICE</strong>
          <span className="mt-1 block text-sm text-foreground-muted">
            Guarda el PDF como documento privado, sin extracción ni conciliación.
          </span>
        </button>
      </div>
    </Modal>
  );
}

export function OrderDetailView({
  detail,
  permissions,
}: {
  detail: ReconciliationOrderDetail;
  permissions: BatchPermissions;
}) {
  const router = useRouter();
  const [typeChoiceOpen, setTypeChoiceOpen] = useState(false);
  const [upload, setUpload] = useState<{
    type: InvoiceType;
    replacement: BatchInvoice | null;
  } | null>(null);
  const [pendingPreview, setPendingPreview] =
    useState<MixtoListoExtractionPreview | null>(null);
  const [review, setReview] = useState<BatchInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useGlobalPending(
    busy,
    "Actualizando conciliación…",
    "Aplicando los contratos del Pedido.",
  );
  async function validateOrder() {
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
      setTypeChoiceOpen(true);
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
  return (
    <MotionPage className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <Link
        href={`/batches/${detail.batchId}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver al lote
      </Link>
      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
              Conciliación · Pedido {detail.orderNumber}
            </p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              {detail.supplierName}
            </h1>
            <p className="mt-2 text-sm text-foreground-muted">
              Lote {detail.batchCode} · {formatBatchDate(detail.periodStart)} –{" "}
              {formatBatchDate(detail.periodEnd)} · período{" "}
              {formatBatchDate(detail.accountingPeriod)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(detail.documentStatus)}`}
              >
                {formatStatusLabel(detail.documentStatus)}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(detail.reconciliationStatus)}`}
              >
                {formatStatusLabel(detail.reconciliationStatus)}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(detail.effectiveStatus)}`}
              >
                {formatStatusLabel(detail.effectiveStatus)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {permissions.canCreateInvoice &&
              detail.effectiveStatus !== "COMPLETED" &&
              permissions.canMatchInvoice && (
                <button
                  className="primary-button gap-2"
                  onClick={() => void validateOrder()}
                >
                  <FileCheck2 className="size-4" /> Validar pedido
                </button>
              )}
            {detail.effectiveStatus === "COMPLETED" && (
              <span className="inline-flex items-center gap-2 rounded-lg bg-success-soft px-4 py-2 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" /> Pedido completado
              </span>
            )}
          </div>
        </div>
        {message && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-destructive-soft p-3 text-sm text-destructive"
          >
            {message}
          </p>
        )}
      </section>
      {detail.pendingMixtoListoIntakes.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/20">
          <h2 className="font-semibold">Extracciones Mixto Listo pendientes</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {detail.pendingMixtoListoIntakes.map((intake) => (
              <article
                key={intake.intakeId}
                className="rounded-lg border border-amber-300 bg-surface p-3 dark:border-amber-900"
              >
                <strong>
                  {intake.invoiceType} · {intake.invoiceNumber}
                </strong>
                <p className="mt-1 text-xs text-foreground-muted">
                  {formatStatusLabel(intake.status)} · Pedido detectado{" "}
                  {intake.detectedOrderNumber ?? "—"}
                </p>
                <button
                  type="button"
                  className="secondary-button mt-3 text-xs"
                  onClick={() => {
                    setPendingPreview(intake);
                    setUpload({ type: "PRODUCT", replacement: null });
                  }}
                >
                  Abrir preview
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold">
            Guías del pedido ({detail.guides.length})
          </h2>
          <div className="mt-3 divide-y divide-border">
            {detail.guides.map((guide) => (
              <div key={guide.guideId} className="py-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <Link
                      href={`/dispatches/${guide.dispatchId}`}
                      className="font-semibold text-brand-strong hover:underline"
                    >
                      {guide.guideNumber}
                    </Link>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {guide.programmingCode} ·{" "}
                      {formatBatchDate(guide.guideDate)} · {formatStatusLabel(guide.result, "Sin resultado")}
                    </p>
                    <p className="mt-1 text-xs text-foreground-muted">
                      Recibido {formatBatchQuantity(guide.receivedQuantity)}{" "}
                      {guide.unitCode}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">
                    {formatBatchQuantity(guide.quantity)} {guide.unitCode}
                  </p>
                </div>
                <div className="mt-3 rounded-lg bg-muted/35 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                    Documentos de Guide ({guide.documents.length})
                  </p>
                  <div className="mt-2 space-y-2">
                    {guide.documents.map((document) => (
                      <div
                        key={document.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {document.fileName ?? document.category}
                          </p>
                          <p className="text-foreground-muted">
                            {formatStatusLabel(document.purpose)} ·{" "}
                            {formatStatusLabel(document.uploadStatus, "Sin versión")} ·{" "}
                            {document.createdByName} ·{" "}
                            {formatBatchDate(document.createdAt.slice(0, 10))}
                          </p>
                        </div>
                        {document.uploadStatus === "UPLOADED" && document.fileName && document.mimeType && (
                          <DocumentActions projectId={detail.projectId} documentId={document.id} fileName={document.fileName} mimeType={document.mimeType} getSignedUrl={getDocumentDownloadUrl} compact />
                        )}
                      </div>
                    ))}
                    {!guide.documents.length && (
                      <p className="text-foreground-muted">
                        Sin documentos adjuntos.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold">Facturas del pedido ({detail.invoices.length})</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-brand-strong">
              PRODUCT {detail.productInvoiceCount}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1">
              SERVICE {detail.serviceInvoiceCount}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {detail.invoices.map((invoice) => (
              <article
                key={invoice.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong>
                      {formatStatusLabel(invoice.type)} · {invoice.number}
                    </strong>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {formatStatusLabel(invoice.status)} · {invoice.currency}{" "}
                      {formatBatchQuantity(invoice.total)}
                      {invoice.pcaOriginal ? ` · ${invoice.pcaOriginal}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {invoice.type === "SERVICE" ? (
                        <>Extracción y conciliación: No aplica</>
                      ) : (
                        <>Pedido detectado {invoice.orderNumber ?? "—"} · Extracción{" "}
                          {formatStatusLabel(invoice.extractionStatus, "Sin verificar")}</>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {invoice.fileName ?? "Sin PDF"} · {invoice.createdByName}{" "}
                      · {formatBatchDate(invoice.createdAt.slice(0, 10))}
                    </p>
                  </div>
                  {invoice.documentId && invoice.fileName && (
                    <DocumentActions projectId={detail.projectId} documentId={invoice.documentId} fileName={invoice.fileName} mimeType="application/pdf" getSignedUrl={getInvoiceDownloadUrl} compact />
                  )}
                </div>
                {invoice.type === "PRODUCT" && <details className="mt-3 rounded-lg bg-muted/35 p-3">
                  <summary className="cursor-pointer text-xs font-semibold">
                    Líneas de factura ({invoice.lines.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {invoice.lines.map((line, index) => (
                      <div
                        key={`${invoice.id}-${index}`}
                        className="grid gap-1 text-xs sm:grid-cols-[7rem_minmax(0,1fr)_7rem]"
                      >
                        <span className="font-mono font-semibold">
                          {line.code ?? "Sin código"}
                        </span>
                        <span>{line.description}</span>
                        <span className="font-semibold sm:text-right">
                          {formatBatchQuantity(line.quantity)}{" "}
                          {line.unitCode ?? ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {permissions.canMatchInvoice &&
                    invoice.extractionStatus === "PENDING" && (
                      <button
                        className="secondary-button text-xs"
                        onClick={() => setReview(invoice)}
                      >
                        <FileCheck2 className="size-3.5" /> Revisar extracción
                        histórica
                      </button>
                    )}
                  {permissions.canMatchInvoice &&
                    invoice.type === "PRODUCT" &&
                    detail.effectiveStatus === "REINVOICING" &&
                    !["SUPERSEDED", "CANCELLED", "REINVOICING"].includes(invoice.status) && (
                      <button
                        className="secondary-button text-xs"
                        onClick={() => void requestReinvoicing(invoice)}
                      >
                        Solicitar refacturación
                      </button>
                    )}
                  {permissions.canCreateInvoice &&
                    invoice.type === "PRODUCT" &&
                    detail.effectiveStatus === "REINVOICING" &&
                    invoice.status === "REINVOICING" && (
                      <button
                        className="primary-button text-xs"
                        onClick={() => {
                          setPendingPreview(null);
                          setUpload({ type: "PRODUCT", replacement: invoice });
                        }}
                      >
                        Cargar replacement PRODUCT
                      </button>
                    )}
                </div>
                {invoice.replacesInvoiceId && (
                  <p className="mt-2 text-[11px] text-foreground-muted">
                    Reemplaza: {invoice.replacesInvoiceId}
                  </p>
                )}
                {invoice.replacedByInvoiceId && (
                  <p className="mt-2 text-[11px] text-foreground-muted">
                    Reemplazada por: {invoice.replacedByInvoiceId}
                  </p>
                )}
              </article>
            ))}
            {!detail.invoices.length && (
              <p className="text-sm text-foreground-muted">
                Carga progresiva habilitada: puedes agregar facturas de producto y servicio
                por separado.
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-5">
          <h2 className="font-semibold">Comparación de cantidades</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            Se compara la cantidad PRODUCT facturada contra la despachada por
            medida. Código y descripción son únicamente informativos.
          </p>
        </div>
        <div className="divide-y divide-border">
          {detail.lines.map((line) => (
            <details key={line.id} className="group p-5">
              <summary className="cursor-pointer list-none">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,8rem)_10rem]">
                  <div>
                    <p className="font-semibold">
                      {line.productCode} · {line.productDescription}
                    </p>
                    <p className="mt-1 text-xs text-foreground-muted">
                      {line.unitCode ?? "Sin UM"} · {line.guideCount} guía(s) ·{" "}
                      {line.invoiceCount} factura(s)
                    </p>
                  </div>
                  <Metric
                    label="Despachado"
                    value={line.dispatchedTotal}
                    unit={line.unitCode}
                  />
                  <Metric
                    label="Facturado"
                    value={line.invoicedTotal}
                    unit={line.unitCode}
                  />
                  <Metric
                    label="Diferencia"
                    value={line.difference}
                    unit={line.unitCode}
                  />
                  <span
                    className={`self-center rounded-full px-2 py-1 text-center text-[10px] font-semibold ${statusTone(line.status)}`}
                  >
                    {formatStatusLabel(line.status)}
                  </span>
                </div>
              </summary>
              <div className="mt-4 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
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
            </details>
          ))}
          {!detail.lines.length && (
            <p className="p-8 text-center text-sm text-foreground-muted">
              Todavía no hay líneas conciliadas.
            </p>
          )}
        </div>
      </section>
      {typeChoiceOpen && (
        <InvoiceTypeDialog
          orderNumber={detail.orderNumber}
          onSelect={(type) => {
            setTypeChoiceOpen(false);
            setPendingPreview(null);
            setUpload({ type, replacement: null });
          }}
          onClose={() => setTypeChoiceOpen(false)}
        />
      )}
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
