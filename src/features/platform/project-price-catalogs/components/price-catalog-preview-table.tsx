"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { PriceCatalogPreview } from "../types";

const PAGE_SIZE = 25;

export function PriceCatalogPreviewTable({
  preview,
  disabled = false,
}: {
  preview: PriceCatalogPreview;
  disabled?: boolean;
}) {
  const [requestedPage, setPage] = useState(1);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows = errorsOnly ? preview.rows.filter((row) => row.errors.length > 0) : preview.rows;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  const label = preview.catalogKind === "PRODUCT" ? "productos" : "servicios";

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {preview.errorCount > 0 && (
        <label className="flex cursor-pointer items-center gap-2 border-b border-border px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={errorsOnly}
            disabled={disabled}
            onChange={(event) => {
              setErrorsOnly(event.target.checked);
              setPage(1);
            }}
          />
          Mostrar solo filas con errores ({preview.errorCount})
        </label>
      )}
      <div className="max-h-[min(55dvh,34rem)] overflow-auto">
        <table className="w-full min-w-[680px] text-left text-sm" aria-label={`Vista previa de ${label}`}>
          <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Fila</th>
              <th scope="col" className="px-4 py-3">Código</th>
              {preview.catalogKind === "PRODUCT" && <th scope="col" className="px-4 py-3">Referencia</th>}
              {preview.catalogKind === "SERVICE" && <><th scope="col" className="px-4 py-3">Descripción</th><th scope="col" className="px-4 py-3">UM</th></>}
              <th scope="col" className="px-4 py-3 text-right">Precio</th>
              <th scope="col" className="px-4 py-3">Validación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pageRows.map((row) => (
              <tr key={row.rowNumber}>
                <td className="px-4 py-3 text-foreground-muted">{row.rowNumber}</td>
                <td className="px-4 py-3 font-mono">{row.code || "—"}</td>
                {preview.catalogKind === "PRODUCT" && <td className="px-4 py-3 font-mono">{row.reference || "—"}</td>}
                {preview.catalogKind === "SERVICE" && <><td className="px-4 py-3">{row.description || "—"}</td><td className="px-4 py-3">{row.unitCode || "—"}</td></>}
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
      </div>
      <nav
        aria-label={`Paginación de vista previa de ${label}`}
        className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
      >
        <p role="status" className="text-xs text-foreground-muted">
          Mostrando {rows.length ? start + 1 : 0}–{Math.min(start + PAGE_SIZE, rows.length)} de {rows.length} registros
          {errorsOnly ? " con errores" : ""}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={disabled || page === 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            Página
            <select
              aria-label={`Página de vista previa de ${label}`}
              className="form-input w-auto"
              value={page}
              disabled={disabled || totalPages === 1}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= 1 && next <= totalPages) setPage(next);
              }}
            >
              {Array.from({ length: totalPages }, (_, index) => (
                <option key={index + 1} value={index + 1}>{index + 1}</option>
              ))}
            </select>
            de {totalPages}
          </label>
          <Button variant="secondary" disabled={disabled || page === totalPages} onClick={() => setPage(page + 1)}>
            Siguiente
          </Button>
        </div>
      </nav>
    </div>
  );
}
