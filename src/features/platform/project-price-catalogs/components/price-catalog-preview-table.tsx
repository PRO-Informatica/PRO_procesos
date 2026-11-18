"use client";

import { Pagination } from "@/components/ui/pagination";
import { useState } from "react";

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
  const columnWidths = serviceCatalog
    ? ["6%", "11%", "22%", "22%", "8%", "10%", "21%"]
    : ["6%", "13%", "18%", "11%", "14%", "13%", "25%"];
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
        <table className={`w-full table-fixed border-separate border-spacing-0 text-left text-sm ${serviceCatalog ? "min-w-[68rem]" : "min-w-[62rem]"}`} aria-label={`Vista previa de ${label}`}>
          <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead className="text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th scope="col" className={headerClass}>Fila</th>
              <th scope="col" className={headerClass}>Código</th>
              {!serviceCatalog && (
                <>
                  <th scope="col" className={headerClass}>Referencia</th>
                  <th scope="col" className={headerClass}>Resistencia PSI</th>
                  <th scope="col" className={headerClass}>Slump en obra (plg)</th>
                </>
              )}
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
                {!serviceCatalog && (
                  <>
                    <td className="px-4 py-3 font-mono">{row.reference || "—"}</td>
                    <td className="px-4 py-3">{row.resistancePsi === undefined ? "No incluido" : row.resistancePsi ?? "—"}</td>
                    <td className="px-4 py-3">{row.slump === undefined ? "No incluido" : row.slump || "—"}</td>
                  </>
                )}
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
      <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} disabled={disabled} itemLabel={errorsOnly ? "registros con errores" : "registros"} ariaLabel={`Paginación de vista previa de ${label}`} className="border-t border-border" />
    </div>
  );
}
