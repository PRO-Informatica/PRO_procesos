"use client";

import { AlertTriangle, FileText, Files, Upload } from "lucide-react";
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

type BulkRow = { key: string; file: File; inspection: InvoiceInspection | null; saved: boolean };

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

  function inspectAll() {
    startTransition(async () => {
      const next: BulkRow[] = [];
      for (const row of rows) {
        const data = new FormData();
        data.set("file", row.file);
        next.push({ ...row, inspection: await inspectBatchInvoicePdf(projectId, batchId, data) });
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
        if (!result?.payload || !result.dispatchId || !result.requestedType || result.duplicate || duplicateKeys.has(duplicateKey) || !["READY", "WITH_DIFFERENCES"].includes(result.status)) continue;
        const data = new FormData();
        data.set("file", row.file);
        const response = await saveDispatchInvoice(projectId, batchId, result.dispatchId, result.requestedType, null, data);
        if (response.status === "success") {
          next[index] = { ...row, saved: true };
          saved += 1;
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
    return result?.payload && !result.duplicate && !duplicateKeys.has(key) && ["READY", "WITH_DIFFERENCES"].includes(result.status);
  }).length;

  return (
    <Modal title="Carga masiva de facturas" description="La vista previa no persiste documentos, asociaciones ni conciliaciones." icon={Files} onClose={onClose} pending={pending} wide>
      <div className="space-y-4 p-5 sm:p-6">
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="form-input"
          onChange={(event) => setRows(Array.from(event.target.files ?? []).map((file, index) => ({ key: `${file.name}:${file.size}:${index}`, file, inspection: null, saved: false })))}
        />
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-muted/60 uppercase text-foreground-muted"><tr><th className="p-3">Archivo</th><th className="p-3">Despacho</th><th className="p-3">Tipo</th><th className="p-3">Resultado</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const result = row.inspection;
                  const key = result?.dispatchId && result.requestedType ? `${result.dispatchId}:${result.requestedType}` : "";
                  const duplicated = duplicateKeys.has(key);
                  return <tr key={row.key}><td className="p-3 font-semibold">{row.file.name}</td><td className="p-3">{result?.dispatchId ? `DSP-${result.dispatchId.slice(0, 8).toUpperCase()}` : "—"}</td><td className="p-3">{result?.requestedType ?? "—"}</td><td className="p-3"><span className={duplicated ? "text-destructive" : ""}>{row.saved ? "Guardada" : duplicated ? "Requiere revisión: factura duplicada" : result?.message ?? "Pendiente de validar"}</span></td></tr>;
                })}
              </tbody>
            </table>
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
