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
  const serviceCatalog = preview.catalogKind === "SERVICE";
  const columnWidths = serviceCatalog ? ["6%", "11%", "22%", "22%", "8%", "10%", "21%"] : ["9%", "17%", "28%", "17%", "29%"];
  const headerClass = "sticky top-0 z-10 border-b border-border bg-muted px-4 py-3 align-top leading-5 [overflow-wrap:anywhere]";

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
      <div className="relative isolate max-h-[min(55dvh,34rem)] overflow-auto" role="region" aria-label={`Filas de vista previa de ${label}`} tabIndex={0}>
        <table className={`w-full table-fixed border-separate border-spacing-0 text-left text-sm ${serviceCatalog ? "min-w-[68rem]" : "min-w-[46rem]"}`} aria-label={`Vista previa de ${label}`}>
          <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead className="text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th scope="col" className={headerClass}>Fila</th>
              <th scope="col" className={headerClass}>Código</th>
              {!serviceCatalog && <th scope="col" className={headerClass}>Referencia</th>}
              {serviceCatalog && <><th scope="col" className={headerClass}>Descripción</th><th scope="col" className={headerClass}>Observaciones</th><th scope="col" className={headerClass}>UM</th></>}
              <th scope="col" className={`${headerClass} text-right`}>Precio</th>
              <th scope="col" className={headerClass}>Validación</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-b [&_td]:border-border [&_td]:align-top [&_td]:[overflow-wrap:anywhere]">
            {pageRows.map((row) => (
              <tr key={row.rowNumber}>
                <td className="px-4 py-3 text-foreground-muted">{row.rowNumber}</td>
                <td className="px-4 py-3 font-mono">{row.code || "—"}</td>
                {preview.catalogKind === "PRODUCT" && <td className="px-4 py-3 font-mono">{row.reference || "—"}</td>}
                {serviceCatalog && <><td className="px-4 py-3">{row.description || "—"}</td><td className="px-4 py-3">{row.observations || "—"}</td><td className="px-4 py-3">{row.unitCode || row.rawUnitCode || "Sin UM"}</td></>}
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
            <span className="whitespace-nowrap">Página</span>
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
            <span className="whitespace-nowrap">de {totalPages}</span>
          </label>
          <Button variant="secondary" disabled={disabled || page === totalPages} onClick={() => setPage(page + 1)}>
            Siguiente
          </Button>
        </div>
      </nav>
    </div>
  );
}
