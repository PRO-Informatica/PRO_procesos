"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { LoadingButton } from "@/components/feedback/loading-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

import {
  importProjectPriceCatalogAction,
  previewProjectPriceCatalogAction,
} from "../actions";
import type {
  PriceCatalogImportMode,
  PriceCatalogKind,
  PriceCatalogPreview,
} from "../types";

export function ImportPriceCatalogDialog({
  companyId,
  projectId,
  catalogKind,
}: {
  companyId: string;
  projectId: string;
  catalogKind: PriceCatalogKind;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PriceCatalogPreview | null>(null);
  const [mode, setMode] = useState<PriceCatalogImportMode>("UPDATE");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = catalogKind === "PRODUCT" ? "productos" : "servicios";

  function reset() {
    setFile(null);
    setPreview(null);
    setMode("UPDATE");
    setMessage(null);
    setIsError(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function buildFormData() {
    const formData = new FormData();
    formData.set("companyId", companyId);
    formData.set("projectId", projectId);
    formData.set("catalogKind", catalogKind);
    if (file) formData.set("file", file);
    return formData;
  }

  function runPreview() {
    if (!file) {
      setIsError(true);
      setMessage("Selecciona un archivo .xlsx.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await previewProjectPriceCatalogAction(buildFormData());
      if (result.status === "error") {
        setPreview(null);
        setIsError(true);
        setMessage(result.message);
        return;
      }
      setPreview(result);
      setIsError(result.errorCount > 0);
      setMessage(
        result.errorCount > 0
          ? "Corrige los errores indicados antes de confirmar la importación."
          : "La validación terminó sin errores. Ya puedes confirmar.",
      );
    });
  }

  function runImport() {
    if (!file || !preview || preview.errorCount > 0) return;
    const formData = buildFormData();
    formData.set("mode", mode);
    setMessage(null);
    startTransition(async () => {
      const result = await importProjectPriceCatalogAction(formData);
      if (result.status === "error") {
        setIsError(true);
        setMessage(result.message);
        return;
      }
      setIsError(false);
      setMessage(
        `${result.message} ${result.insertedCount} nuevo(s), ${result.updatedCount} actualizado(s), ${result.totalCount} total.`,
      );
      router.refresh();
      setTimeout(close, 900);
    });
  }

  const errorRows = preview?.rows.filter((row) => row.errors.length > 0) ?? [];

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload aria-hidden="true" className="size-4" />
        Importar catálogo Excel
      </Button>
      {open && (
        <Dialog
          title={`Importar catálogo de ${label}`}
          description="El archivo se valida primero; ningún dato se guarda hasta confirmar."
          icon={FileSpreadsheet}
          onClose={close}
          pending={pending}
          size="xl"
        >
          <div className="space-y-5 p-4 sm:p-6">
            <div>
              <label className="form-label" htmlFor={`catalog-file-${catalogKind}`}>
                Archivo Excel .xlsx *
              </label>
              <input
                ref={inputRef}
                id={`catalog-file-${catalogKind}`}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="form-input file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:font-semibold"
                disabled={pending}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPreview(null);
                  setMessage(null);
                }}
              />
              <p className="mt-2 text-xs text-foreground-muted">
                Máximo 10 MiB y 10,000 registros. {catalogKind === "PRODUCT"
                  ? "Columnas: codigo, referencia, precio."
                  : "Columnas: codigo, precio."}
              </p>
            </div>

            <LoadingButton
              type="button"
              variant="secondary"
              loading={pending}
              loadingLabel="Validando…"
              onClick={runPreview}
            >
              Validar y generar vista previa
            </LoadingButton>

            {message && (
              <p
                role={isError ? "alert" : "status"}
                className={`rounded-lg px-4 py-3 text-sm ${
                  isError
                    ? "bg-destructive-soft text-destructive"
                    : "bg-success-soft text-success"
                }`}
              >
                {message}
              </p>
            )}

            {preview && (
              <>
                <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
                  <Summary label="Archivo" value={preview.fileName} />
                  <Summary label="Registros" value={String(preview.totalCount)} />
                  <Summary label="Válidos" value={String(preview.validCount)} />
                  <Summary label="Con errores" value={String(preview.errorCount)} />
                </dl>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="bg-muted text-xs uppercase tracking-wide text-foreground-muted">
                      <tr>
                        <th className="px-4 py-3">Fila</th>
                        <th className="px-4 py-3">Código</th>
                        {catalogKind === "PRODUCT" && <th className="px-4 py-3">Referencia</th>}
                        <th className="px-4 py-3 text-right">Precio</th>
                        <th className="px-4 py-3">Validación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.rows.slice(0, 25).map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="px-4 py-3 text-foreground-muted">{row.rowNumber}</td>
                          <td className="px-4 py-3 font-mono">{row.code || "—"}</td>
                          {catalogKind === "PRODUCT" && <td className="px-4 py-3 font-mono">{row.reference || "—"}</td>}
                          <td className="px-4 py-3 text-right">{row.price || "—"}</td>
                          <td className="px-4 py-3">
                            {row.errors.length ? (
                              <span className="text-destructive">{row.errors.join(" ")}</span>
                            ) : (
                              <span className="text-success">Válida</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.rows.length > 25 && (
                    <p className="border-t border-border px-4 py-3 text-xs text-foreground-muted">
                      Se muestran las primeras 25 filas de {preview.totalCount}.
                    </p>
                  )}
                </div>

                {errorRows.length > 0 && (
                  <div className="rounded-xl border border-destructive/25 bg-destructive-soft p-4">
                    <h3 className="font-semibold text-destructive">Errores encontrados</h3>
                    <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-destructive">
                      {errorRows.slice(0, 100).map((row) => (
                        <li key={row.rowNumber}>Fila {row.rowNumber}: {row.errors.join(" ")}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.errorCount === 0 && (
                  <fieldset className="rounded-xl border border-border p-4">
                    <legend className="px-2 text-sm font-semibold">Modalidad de importación</legend>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-muted">
                      <input type="radio" name={`mode-${catalogKind}`} checked={mode === "UPDATE"} onChange={() => setMode("UPDATE")} />
                      <span><strong>Actualizar catálogo</strong><span className="mt-1 block text-sm text-foreground-muted">Actualiza coincidencias, agrega registros nuevos y conserva los que no aparecen.</span></span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-muted">
                      <input type="radio" name={`mode-${catalogKind}`} checked={mode === "REPLACE"} onChange={() => setMode("REPLACE")} />
                      <span><strong>Reemplazar catálogo</strong><span className="mt-1 block text-sm text-foreground-muted">Sustituye todo este catálogo de forma atómica. El otro catálogo no cambia.</span></span>
                    </label>
                  </fieldset>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={pending}>Cancelar</Button>
            <LoadingButton
              type="button"
              loading={pending}
              loadingLabel="Importando…"
              disabled={!preview || preview.errorCount > 0}
              onClick={runImport}
            >
              Confirmar importación
            </LoadingButton>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="mt-1 truncate font-semibold text-foreground" title={value}>{value}</dd>
    </div>
  );
}
