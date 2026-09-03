"use client";

import { FileSpreadsheet, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useEffect, useMemo, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { FileDropField } from "@/components/forms/file-drop-field";

import {
  createProgrammingBatchAction,
  extractProgrammingWorkbookAction,
} from "../actions";
import {
  initialCreateProgrammingBatchState,
  initialExtractProgrammingWorkbookState,
  type BulkProgrammingPreviewRow,
  type ProgrammingSupplier,
} from "../types";

function rowErrors(row: BulkProgrammingPreviewRow, today: string) {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.scheduledAt)) errors.push("Fecha u hora inválida");
  else if (row.scheduledAt.slice(0, 10) < today) errors.push("La fecha es anterior a hoy");
  if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) errors.push("Volumen inválido");
  if (!row.unitCode) errors.push("Falta unidad");
  if (!row.supplierId) errors.push("Selecciona un proveedor");
  if (!row.concreteType.trim()) errors.push("Falta tipo de concreto");
  if (!row.placementElement.trim()) errors.push("Falta elemento a fundir");
  return errors;
}

function notesFor(row: BulkProgrammingPreviewRow) {
  return [
    row.concreteType && `Tipo de concreto: ${row.concreteType}`,
    row.placementElement && `Elemento a fundir: ${row.placementElement}`,
    row.truckInterval && `Tiempo entre camiones: ${row.truckInterval}`,
  ].filter(Boolean).join("\n");
}

export function BulkProgrammingDialog({
  open,
  projectId,
  billingLegalName,
  timezone,
  suppliers,
  today,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  billingLegalName: string | null;
  timezone: string;
  suppliers: ProgrammingSupplier[];
  today: string;
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const [extractState, extractAction, extracting] = useActionState(
    extractProgrammingWorkbookAction,
    initialExtractProgrammingWorkbookState,
  );
  const [batchState, batchAction, creating] = useActionState(
    createProgrammingBatchAction,
    initialCreateProgrammingBatchState,
  );
  const [editedRows, setEditedRows] = useState<BulkProgrammingPreviewRow[] | null>(null);
  const rows = useMemo(
    () => editedRows ?? extractState.rows ?? [],
    [editedRows, extractState.rows],
  );
  const pending = extracting || creating;
  useGlobalPending(
    pending,
    extracting ? "Leyendo archivo…" : "Creando programaciones…",
    extracting ? "Validando el formato de Mixto Listo." : "Guardando toda la carga en una transacción.",
  );

  useEffect(() => {
    if (batchState.status === "success") onCreated(batchState.programmingIds?.length ?? rows.length);
  }, [batchState.programmingIds?.length, batchState.status, onCreated, rows.length]);

  const validatedRows = useMemo(
    () => rows.map((row) => ({ ...row, errors: rowErrors(row, today) })),
    [rows, today],
  );
  const valid = validatedRows.length > 0 && validatedRows.every((row) => row.errors.length === 0);
  const update = (index: number, patch: Partial<BulkProgrammingPreviewRow>, rebuildNotes = false) => {
    setEditedRows((current) => (current ?? extractState.rows ?? []).map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, ...patch };
      return rebuildNotes ? { ...next, notes: notesFor(next) } : next;
    }));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-programming-title"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div
            className="my-auto flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            initial={{ y: 10, scale: 0.99 }} animate={{ y: 0, scale: 1 }} exit={{ y: 6, scale: 0.99 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><FileSpreadsheet className="size-5" /></span>
                <div>
                  <h2 id="bulk-programming-title" className="font-semibold text-foreground">Cargar programaciones</h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Solicitud de Concreto de Mixto Listo · Razón Social esperada: {billingLegalName || "Sin configurar"} · {timezone}
                  </p>
                </div>
              </div>
              <button type="button" onClick={onClose} disabled={pending} className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted" aria-label="Cerrar"><X className="size-5" /></button>
            </div>

            <div className="subtle-scrollbar flex-1 overflow-y-auto p-5 sm:p-6">
              {!rows.length ? (
                <form action={extractAction} className="mx-auto max-w-2xl">
                  <input type="hidden" name="projectId" value={projectId} />
                  <FileDropField name="workbook" accept=".xlsx" maxBytes={10 * 1024 * 1024} disabled={pending} />
                  <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4 text-xs leading-5 text-foreground-muted">
                    Se validarán la hoja <strong>Solicitud de Concreto</strong>, el correo de Mixto Listo, la sección Datos para la Fundición y sus encabezados. No se usa OCR.
                  </div>
                  {extractState.status === "error" && <p className="mt-4 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">{extractState.message}</p>}
                  <div className="mt-5 flex justify-end"><LoadingButton loadingLabel="Extrayendo datos…">Vista previa</LoadingButton></div>
                </form>
              ) : (
                <form action={batchAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="rows" value={JSON.stringify(validatedRows)} />
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Vista previa obligatoria</h3>
                      <p className="mt-1 text-xs text-foreground-muted">{validatedRows.length} filas encontradas en {extractState.fileName}. Corrige cualquier fila marcada.</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground-muted hover:bg-muted"><Trash2 className="size-4" /> Cambiar archivo</button>
                  </div>
                  <div className="space-y-4">
                    {validatedRows.map((row, index) => (
                      <section key={`${row.sourceRow}-${index}`} className={`rounded-xl border p-4 ${row.errors.length ? "border-destructive/30 bg-destructive-soft/25" : "border-border"}`}>
                        <div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-foreground">Fila Excel {row.sourceRow}</h4><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.errors.length ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{row.errors.length ? `${row.errors.length} por corregir` : "Lista"}</span></div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <label className="text-xs font-semibold text-foreground-muted">Fecha y hora<input type="datetime-local" className="form-input mt-1" value={row.scheduledAt} onChange={(event) => update(index, { scheduledAt: event.target.value })} /></label>
                          <label className="text-xs font-semibold text-foreground-muted">Proveedor<select className="form-input mt-1" value={row.supplierId} onChange={(event) => update(index, { supplierId: event.target.value })}><option value="">Selecciona</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
                          <label className="text-xs font-semibold text-foreground-muted">Tipo de concreto<input className="form-input mt-1" value={row.concreteType} onChange={(event) => update(index, { concreteType: event.target.value }, true)} /></label>
                          <label className="text-xs font-semibold text-foreground-muted">Volumen<div className="mt-1 flex gap-2"><input type="number" min="0.001" step="0.001" className="form-input" value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /><span className="flex min-h-11 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm font-semibold">{row.unitCode}</span></div></label>
                          <label className="text-xs font-semibold text-foreground-muted md:col-span-1 xl:col-span-2">Elemento a fundir<input className="form-input mt-1" value={row.placementElement} onChange={(event) => update(index, { placementElement: event.target.value }, true)} /></label>
                          <label className="text-xs font-semibold text-foreground-muted md:col-span-1 xl:col-span-2">Tiempo entre camiones<input className="form-input mt-1" value={row.truckInterval} onChange={(event) => update(index, { truckInterval: event.target.value }, true)} /></label>
                          <label className="text-xs font-semibold text-foreground-muted md:col-span-2 xl:col-span-4">Notas<textarea rows={3} maxLength={1000} className="form-input mt-1 resize-y" value={row.notes} onChange={(event) => update(index, { notes: event.target.value })} /></label>
                        </div>
                        {row.errors.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs font-medium text-destructive">{row.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
                      </section>
                    ))}
                  </div>
                  {batchState.status === "error" && <p className="mt-4 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">{batchState.message}</p>}
                  <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground-muted hover:bg-muted">Cancelar</button>
                    <LoadingButton loadingLabel="Cargando programaciones…" disabled={!valid}>Cargar programaciones</LoadingButton>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
