"use client";

import { AlertTriangle, FileText, Files, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  inspectBatchInvoicePdf,
  inspectDispatchInvoicePdf,
  saveDispatchInvoice,
} from "../actions";
import { formatBatchQuantity } from "../formatters";
import type {
  BatchDispatchRelation,
  InvoiceInspection,
  InvoiceType,
} from "../types";
import { Modal } from "./batch-dialogs";

type IndividualProps = {
  projectId: string;
  batchId: string;
  relation: BatchDispatchRelation;
  type: InvoiceType;
  replacement?: boolean;
  onClose: () => void;
};

function inspectionTone(status: InvoiceInspection["status"]) {
  if (status === "READY") return "bg-success-soft text-success";
  if (status === "WITH_DIFFERENCES") {
    return "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  }
  return "bg-destructive-soft text-destructive";
}

function InspectionSummary({ inspection }: { inspection: InvoiceInspection }) {
  return (
    <div className={`rounded-xl p-4 text-sm ${inspectionTone(inspection.status)}`}>
      <p className="font-semibold">{inspection.message}</p>
      {inspection.payload && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div><dt>Factura</dt><dd className="font-semibold">{inspection.payload.invoice_number}</dd></div>
          <div><dt>Pedido detectado</dt><dd className="font-semibold">{inspection.payload.detected_order_number ?? "—"}</dd></div>
          <div><dt>Tipo detectado</dt><dd className="font-semibold">{inspection.payload.detected_type}</dd></div>
          <div><dt>Cantidad conciliable</dt><dd className="font-semibold">{formatBatchQuantity(inspection.payload.invoiced_quantity)} {inspection.payload.normalized_unit ?? ""}</dd></div>
          <div><dt>Volumen Real</dt><dd className="font-semibold">{inspection.payload.expected_real_volume === null ? "Pendiente" : formatBatchQuantity(inspection.payload.expected_real_volume)}</dd></div>
          <div><dt>Diferencia</dt><dd className="font-semibold">{inspection.payload.difference === null ? "No comparable" : formatBatchQuantity(inspection.payload.difference)}</dd></div>
        </dl>
      )}
    </div>
  );
}

export function DispatchInvoiceDialog({
  projectId,
  batchId,
  relation,
  type,
  replacement = false,
  onClose,
}: IndividualProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<InvoiceInspection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function inspect() {
    if (!file) return;
    startTransition(async () => {
      const data = new FormData();
      data.set("file", file);
      const result = await inspectDispatchInvoicePdf(
        projectId,
        batchId,
        relation.dispatchId,
        type,
        data,
      );
      setInspection(result);
      setMessage(null);
    });
  }

  function save() {
    if (!file || !inspection?.payload) return;
    startTransition(async () => {
      const data = new FormData();
      data.set("file", file);
      const replaces = replacement ? relation.productInvoice?.id ?? null : null;
      const result = await saveDispatchInvoice(
        projectId,
        batchId,
        relation.dispatchId,
        type,
        replaces,
        data,
      );
      setMessage(result.message);
      if (result.status === "success") {
        router.refresh();
        onClose();
      }
    });
  }

  const canSave = Boolean(
    inspection?.payload &&
      ["READY", "WITH_DIFFERENCES"].includes(inspection.status) &&
      (!inspection.duplicate || replacement),
  );

  return (
    <Modal
      title={replacement ? "Cargar factura refacturada" : `Cargar factura de ${type === "PRODUCT" ? "producto" : "servicio"}`}
      description={`${relation.programmingCode} · Pedido ${relation.orderNumber ?? "pendiente"}. Un PDF digital corresponde a una factura.`}
      icon={FileText}
      onClose={onClose}
      pending={pending}
    >
      <div className="space-y-4 p-5 sm:p-6">
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="form-input"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setInspection(null);
            setMessage(null);
          }}
        />
        <p className="text-xs text-foreground-muted">Solo PDF digital, máximo 10 MiB. No se utiliza OCR.</p>
        {inspection && <InspectionSummary inspection={inspection} />}
        {inspection?.duplicate && !replacement && (
          <p className="rounded-xl bg-destructive-soft p-3 text-sm text-destructive">
            Ya existe una factura activa de este tipo. No se elegirá ni reemplazará automáticamente.
          </p>
        )}
        {message && <p className="rounded-xl bg-destructive-soft p-3 text-sm text-destructive">{message}</p>}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cancelar</button>
        <button type="button" onClick={inspect} disabled={!file || pending} className="secondary-button gap-2"><FileText className="size-4" /> Validar PDF</button>
        <button type="button" onClick={save} disabled={!canSave || pending} className="primary-button gap-2"><Upload className="size-4" /> {pending ? "Procesando…" : "Guardar factura"}</button>
      </div>
    </Modal>
  );
}

type BulkRow = {
  key: string;
  fingerprint: string;
  file: File;
  inspection: InvoiceInspection | null;
  saved: boolean;
  saveError: string | null;
};

type BulkRowGroup = {
  key: string;
  orderNumber: string | null;
  dispatchId: string | null;
  label: string;
  description: string;
  rows: BulkRow[];
};

function formatInvoiceTotal(total: number, currency: string) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: currency || "GTQ",
    minimumFractionDigits: 2,
  }).format(total);
}

export function BulkInvoiceDialog({
  projectId,
  batchId,
  onClose,
}: {
  projectId: string;
  batchId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    setRows((current) => {
      const fingerprints = new Set(current.map((row) => row.fingerprint));
      const additions = selected.flatMap((file) => {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
        if (fingerprints.has(fingerprint)) return [];
        fingerprints.add(fingerprint);
        return [{
          key: `${fingerprint}:${crypto.randomUUID()}`,
          fingerprint,
          file,
          inspection: null,
          saved: false,
          saveError: null,
        }];
      });
      return [...current, ...additions];
    });
    setMessage(null);
  }

  function removeFile(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
    setMessage(null);
  }
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const result = row.inspection;
      if (result?.dispatchId && result.requestedType) {
        const key = `${result.dispatchId}:${result.requestedType}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  }, [rows]);

  const groupedRows = useMemo<BulkRowGroup[]>(() => {
    const groups = new Map<string, BulkRowGroup>();

    for (const row of rows) {
      const result = row.inspection;
      const orderNumber = result?.payload?.detected_order_number ?? null;
      const dispatchId = result?.dispatchId ?? null;
      const key = dispatchId
        ? `dispatch:${dispatchId}`
        : result
          ? "unassigned"
          : "pending";
      const group = groups.get(key) ?? {
        key,
        orderNumber,
        dispatchId,
        label: dispatchId
          ? `Pedido ${orderNumber ?? "sin número"}`
          : result
            ? "Sin destino asignado"
            : "Pendientes de clasificar",
        description: dispatchId
          ? `Las facturas de este grupo se asociarán al despacho DSP-${dispatchId.slice(0, 8).toUpperCase()}.`
          : result
            ? "Estos PDFs no se guardarán hasta resolver su validación o asociación."
            : "Clasifica los PDFs para identificar el pedido y despacho al que corresponden.",
        rows: [],
      };
      group.rows.push(row);
      groups.set(key, group);
    }

    return [...groups.values()].sort((left, right) => {
      if (left.dispatchId && !right.dispatchId) return -1;
      if (!left.dispatchId && right.dispatchId) return 1;
      return (left.orderNumber ?? left.label).localeCompare(
        right.orderNumber ?? right.label,
        "es",
        { numeric: true },
      );
    });
  }, [rows]);

  function inspectAll() {
    startTransition(async () => {
      const next: BulkRow[] = [];
      for (const row of rows) {
        const data = new FormData();
        data.set("file", row.file);
        if (row.saved) {
          next.push(row);
          continue;
        }
        next.push({ ...row, inspection: await inspectBatchInvoicePdf(projectId, batchId, data), saveError: null });
      }
      setRows(next);
      setMessage(null);
    });
  }

  function saveAll() {
    startTransition(async () => {
      let saved = 0;
      const next = [...rows];
      for (let index = 0; index < next.length; index += 1) {
        const row = next[index];
        const result = row.inspection;
        const duplicateKey = result?.dispatchId && result.requestedType ? `${result.dispatchId}:${result.requestedType}` : "";
        if (row.saved || !result?.payload || !result.dispatchId || !result.requestedType || result.duplicate || duplicateKeys.has(duplicateKey) || !["READY", "WITH_DIFFERENCES"].includes(result.status)) continue;
        const data = new FormData();
        data.set("file", row.file);
        const response = await saveDispatchInvoice(projectId, batchId, result.dispatchId, result.requestedType, null, data);
        if (response.status === "success") {
          next[index] = { ...row, saved: true, saveError: null };
          saved += 1;
        } else {
          next[index] = { ...row, saveError: response.message };
        }
      }
      setRows(next);
      setMessage(`${saved} factura(s) guardada(s). Los casos con error o duplicidad no fueron persistidos.`);
      router.refresh();
    });
  }

  const readyCount = rows.filter((row) => {
    const result = row.inspection;
    const key = result?.dispatchId && result.requestedType ? `${result.dispatchId}:${result.requestedType}` : "";
    return !row.saved && result?.payload && !result.duplicate && !duplicateKeys.has(key) && ["READY", "WITH_DIFFERENCES"].includes(result.status);
  }).length;

  return (
    <Modal title="Carga masiva de facturas" description="La vista previa no persiste documentos, asociaciones ni conciliaciones." icon={Files} onClose={onClose} pending={pending} wide>
      <div className="space-y-4 p-5 sm:p-6">
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="form-input"
          onChange={(event) => {
            addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        {rows.length > 0 && (
          <div className="space-y-4">
            {groupedRows.map((group) => (
              <section key={group.key} className="overflow-hidden rounded-xl border border-border">
                <div className={`flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${group.dispatchId ? "bg-muted/50" : "bg-amber-50/70 dark:bg-amber-950/20"}`}>
                  <div>
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <p className="mt-0.5 text-xs text-foreground-muted">{group.description}</p>
                  </div>
                  <span className="mt-1 w-fit rounded-full bg-background px-2.5 py-1 text-xs font-semibold text-foreground-muted shadow-sm sm:mt-0">
                    {group.rows.length} {group.rows.length === 1 ? "PDF" : "PDFs"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="bg-muted/25 uppercase text-foreground-muted">
                      <tr>
                        <th className="p-3">Archivo PDF</th>
                        <th className="p-3">Factura</th>
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Total</th>
                        <th className="p-3">Resultado</th>
                        <th className="p-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {group.rows.map((row) => {
                        const result = row.inspection;
                        const key = result?.dispatchId && result.requestedType ? `${result.dispatchId}:${result.requestedType}` : "";
                        const duplicated = duplicateKeys.has(key);
                        const payload = result?.payload;
                        return (
                          <tr key={row.key}>
                            <td className="max-w-64 p-3 font-semibold"><span className="block truncate" title={row.file.name}>{row.file.name}</span></td>
                            <td className="p-3">{payload?.invoice_number ?? "—"}</td>
                            <td className="p-3">{result?.requestedType === "PRODUCT" ? "Producto" : result?.requestedType === "SERVICE" ? "Servicio" : "—"}</td>
                            <td className="whitespace-nowrap p-3 font-semibold">{payload ? formatInvoiceTotal(payload.total, payload.currency) : "—"}</td>
                            <td className="max-w-80 p-3"><span className={duplicated || row.saveError || (!group.dispatchId && Boolean(result)) ? "text-destructive" : ""}>{row.saved ? "Guardada" : row.saveError ?? (duplicated ? "Requiere revisión: factura duplicada" : result?.message ?? "Pendiente de validar")}</span></td>
                            <td className="p-3 text-right"><button type="button" disabled={pending || row.saved} onClick={() => removeFile(row.key)} className="inline-grid size-8 place-items-center rounded-lg border border-destructive/25 text-destructive disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Quitar ${row.file.name} de la carga`} title={row.saved ? "La factura ya fue guardada." : "Quitar PDF"}><Trash2 className="size-4" /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
        {message && <p className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
        {duplicateKeys.size > 0 && <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="size-4 shrink-0" /> Dos facturas del mismo tipo para el mismo despacho requieren revisión y no se guardan automáticamente.</p>}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onClose} disabled={pending} className="secondary-button">Cerrar</button>
        <button type="button" onClick={inspectAll} disabled={!rows.length || pending} className="secondary-button">Clasificar facturas</button>
        <button type="button" onClick={saveAll} disabled={!readyCount || pending} className="primary-button">{pending ? "Procesando…" : `Guardar cambios (${readyCount})`}</button>
      </div>
    </Modal>
  );
}
