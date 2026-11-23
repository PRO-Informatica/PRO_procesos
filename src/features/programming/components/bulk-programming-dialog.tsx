"use client";

import { FileSpreadsheet, Trash2 } from "lucide-react";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { FileDropField } from "@/components/forms/file-drop-field";
import { Dialog } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";
import { notify } from "@/lib/notify";

import {
  createProgrammingBatchAction,
  extractProgrammingWorkbookAction,
} from "../actions";
import { deliveryModeLabel, requiresServiceInvoice } from "../invoice-policy";
import { isValidApprovedProgrammingDateTime } from "../approved-import-validation";
import {
  initialCreateProgrammingBatchState,
  initialExtractProgrammingWorkbookState,
  type BulkProgrammingPreviewRow,
  type ProgrammingSupplier,
} from "../types";

function rowErrors(row: BulkProgrammingPreviewRow) {
  const errors: string[] = [];
  if (!isValidApprovedProgrammingDateTime(row.scheduledAt)) errors.push("Fecha u hora inválida");
  if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) errors.push("Volumen inválido");
  if (!row.unitCode) errors.push("Falta unidad");
  if (!row.supplierId) errors.push("Selecciona un proveedor");
  if (!row.orderNumber.trim()) errors.push("Falta Pedido No.");
  if (!row.concreteType.trim()) errors.push("Falta tipo de concreto");
  if (!row.placementElement.trim()) errors.push("Falta elemento a fundir");
  if (row.notes.length > 1000) errors.push("Las notas pueden tener hasta 1000 caracteres");
  return errors;
}

export function BulkProgrammingDialog({
  open,
  projectId,
  billingLegalName,
  timezone,
  suppliers,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  billingLegalName: string | null;
  timezone: string;
  suppliers: ProgrammingSupplier[];
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
  const notifiedBatch = useRef<string | null>(null);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const rows = useMemo(
    () => editedRows ?? extractState.rows ?? [],
    [editedRows, extractState.rows],
  );
  const pending = extracting || creating;

  useEffect(() => {
    if (batchState.status === "success") {
      const notificationKey = (batchState.programmingIds ?? []).join(":") || `rows:${rows.length}`;
      if (notifiedBatch.current === notificationKey) return;
      notifiedBatch.current = notificationKey;
      const count = batchState.programmingIds?.length ?? rows.length;
      notify.success(notifications.programmingImported, `${count} ${count === 1 ? "registro creado" : "registros creados"}.`);
      onCreated(count);
    }
  }, [batchState.programmingIds, batchState.status, onCreated, rows.length]);

  const validatedRows = useMemo(
    () => rows.map((row) => ({ ...row, errors: rowErrors(row) })),
    [rows],
  );
  const valid = validatedRows.length > 0 && validatedRows.every((row) => row.errors.length === 0);
  const update = (index: number, patch: Partial<BulkProgrammingPreviewRow>) => {
    setEditedRows((current) => (current ?? extractState.rows ?? []).map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...patch } : row,
    ));
  };
  const submitWorkbook = (event: FormEvent<HTMLFormElement>, action: (data: FormData) => void) => {
    event.preventDefault();
    if (!workbookFile || pending) return;
    const data = new FormData(event.currentTarget);
    data.set("workbook", workbookFile);
    startTransition(() => action(data));
  };

  if (!open) return null;
  return (
    <Dialog title="Cargar programaciones" description={`Solicitud de Concreto · Razón social: ${billingLegalName || "Sin configurar"} · ${timezone}`} icon={FileSpreadsheet} onClose={onClose} pending={pending} size="full">
            <div className="subtle-scrollbar max-h-[calc(92vh-5rem)] overflow-y-auto p-5 sm:p-6">
              {!rows.length ? (
                <form onSubmit={(event) => submitWorkbook(event, extractAction)} className="mx-auto max-w-2xl">
                  <input type="hidden" name="projectId" value={projectId} />
                  <FileDropField name="workbook" accept=".xlsx" maxBytes={10 * 1024 * 1024} disabled={pending} onFileChange={setWorkbookFile} />
                  <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4 text-xs leading-5 text-foreground-muted">
                    Se validarán la hoja <strong>Solicitud de Concreto</strong>, el correo de Mixto Listo, la sección Datos para la Fundición y sus encabezados. No se usa OCR.
                  </div>
                  {extractState.status === "error" && <p className="mt-4 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">{extractState.message}</p>}
                  {extractState.status === "success" && extractState.warnings?.map((warning) => (
                    <p key={warning} className="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning" role="status">{warning}</p>
                  ))}
                  <div className="mt-5 flex justify-end"><LoadingButton loading={extracting} loadingLabel="Extrayendo datos…" disabled={!workbookFile}>Vista previa</LoadingButton></div>
                </form>
              ) : (
                <form onSubmit={(event) => submitWorkbook(event, batchAction)}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="rows" value={JSON.stringify(validatedRows.map(({ sourceRow, scheduledAt, supplierId, notes }) => ({ sourceRow, scheduledAt, supplierId, notes })))} />
                  {extractState.warnings?.map((warning) => (
                    <p
                      key={warning}
                      className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm leading-6 text-warning"
                      role="status"
                    >
                      {warning}
                    </p>
                  ))}
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Vista previa obligatoria</h3>
                      <p className="mt-1 text-xs text-foreground-muted">{validatedRows.length} filas de {extractState.fileName}. Revisa y corrige la fecha y la hora antes de cargar.</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground-muted hover:bg-muted"><Trash2 className="size-4" /> Cambiar archivo</button>
                  </div>
                  <div className="space-y-4">
                    {validatedRows.map((row, index) => {
                      const [date, time] = row.scheduledAt.split("T");
                      return (
                      <section key={`${row.sourceRow}-${index}`} className={`rounded-xl border p-4 ${row.errors.length ? "border-destructive/30 bg-destructive-soft/25" : "border-border"}`}>
                        <div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-foreground">Fila Excel {row.sourceRow}</h4><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.errors.length ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"}`}>{row.errors.length ? `${row.errors.length} por corregir` : "Lista"}</span></div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="md:col-span-2">
                            <div className="grid min-w-0 gap-3 min-[500px]:grid-cols-2">
                              <label className="min-w-0 text-xs font-semibold text-foreground-muted">Fecha programada<input type="date" className="form-input mt-1 min-w-0" value={date} onChange={(event) => update(index, { scheduledAt: `${event.target.value}T${time}` })} disabled={pending} required /></label>
                              <label className="min-w-0 text-xs font-semibold text-foreground-muted">Hora programada<input type="time" className="form-input mt-1 min-w-0" value={time} onChange={(event) => update(index, { scheduledAt: `${date}T${event.target.value}` })} disabled={pending} required /></label>
                            </div>
                            <p className="mt-1 break-words text-xs text-foreground-muted">Excel · {row.workbookDate || "sin fecha"} · {row.workbookTime || "sin hora"}{row.requestedDate && ` · Fecha solicitada ${row.requestedDate}`}</p>
                            {row.dateWarning && <p className="mt-1 text-xs font-medium text-warning">{row.dateWarning}</p>}
                          </div>
                          <label className="text-xs font-semibold text-foreground-muted">Proveedor<select className="form-input mt-1" value={row.supplierId} onChange={(event) => update(index, { supplierId: event.target.value })}><option value="">Selecciona</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
                          <label className="text-xs font-semibold text-foreground-muted">Pedido No.<input className="form-input mt-1 disabled:bg-muted" value={row.orderNumber} disabled /></label>
                          <label className="text-xs font-semibold text-foreground-muted">Tipo de concreto<input className="form-input mt-1 disabled:bg-muted" value={row.concreteType} disabled /></label>
                          <div className="text-xs font-semibold text-foreground-muted">
                            Modalidad del Excel
                            <p className="mt-1 text-sm text-foreground">{deliveryModeLabel(row.deliveryModes)}</p>
                            <p className="mt-1 font-normal">{requiresServiceInvoice(row.deliveryModes) ? "Producto conciliado + servicio" : "Producto conciliado; servicio opcional"}</p>
                          </div>
                          <label className="text-xs font-semibold text-foreground-muted">Volumen<div className="mt-1 flex gap-2"><input type="number" className="form-input disabled:bg-muted" value={row.quantity} disabled /><span className="flex min-h-11 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm font-semibold">{row.unitCode}</span></div></label>
                          <label className="text-xs font-semibold text-foreground-muted">Elemento a fundir<input className="form-input mt-1 disabled:bg-muted" value={row.placementElement} disabled /></label>
                          <label className="text-xs font-semibold text-foreground-muted">Adicionales al concreto<input className="form-input mt-1 disabled:bg-muted" value={row.additions} disabled /></label>
                          <label className="text-xs font-semibold text-foreground-muted md:col-span-1 xl:col-span-2">Tiempo entre camiones<input className="form-input mt-1 disabled:bg-muted" value={row.truckInterval} disabled /></label>
                          <label className="text-xs font-semibold text-foreground-muted md:col-span-2 xl:col-span-4">Notas<textarea rows={3} maxLength={1000} className="form-input mt-1 resize-y" value={row.notes} onChange={(event) => update(index, { notes: event.target.value })} /></label>
                        </div>
                        {row.errors.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs font-medium text-destructive">{row.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
                      </section>
                      );
                    })}
                  </div>
                  {batchState.status === "error" && <p className="mt-4 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">{batchState.message}</p>}
                  <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground-muted hover:bg-muted">Cancelar</button>
                    <LoadingButton loading={creating} loadingLabel="Cargando programaciones…" disabled={!valid}>Cargar programaciones</LoadingButton>
                  </div>
                </form>
              )}
            </div>
    </Dialog>
  );
}
