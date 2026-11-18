"use client";

import { useState, type ReactNode } from "react";

import { MotionSwap } from "@/components/motion/motion-swap";
import { Pagination } from "@/components/ui/pagination";
import styles from "./report-results-table.module.css";

const PAGE_SIZE = 8;
const columns = [
  "Despacho", "Pedido", "Estado del despacho", "Conciliación de producto", "Conciliación de servicio",
  "Volumen real", "Diferencia de producto", "Diferencia de servicio",
  "Proyecto", "Proveedor", "Fecha programada", "Programación", "Empresa", "Lote",
  "Factura de producto", "Total factura producto", "Extracción de producto",
  "Factura de servicio", "Total factura servicio", "Extracción de servicio",
  "Guías", "Incidencias", "Elemento a fundir", "Camión", "Laboratorio", "Validado por", "Acciones",
];
const numericColumns = new Set([
  "Volumen real", "Diferencia de producto", "Diferencia de servicio",
  "Total factura producto", "Total factura servicio", "Guías", "Incidencias",
]);

export function ReportResultsPagination({
  results,
  selectable = false,
  paginationLabel = "Paginación de resultados de reportería",
}: {
  results: ReactNode[];
  selectable?: boolean;
  paginationLabel?: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstItem = currentPage * PAGE_SIZE;
  const visible = results.slice(firstItem, firstItem + PAGE_SIZE);

  return (
    <>
      <div className="overflow-hidden">
        <MotionSwap motionKey={currentPage}>
          <section className={styles.container}>
            <div className={styles.heading}>
              <h2 id="report-dispatches">Despachos</h2>
              <p className="text-xs font-normal text-foreground-muted sm:hidden">Desliza para ver más columnas.</p>
            </div>
            <div
              className={styles.viewport}
              tabIndex={0}
              role="region"
              aria-labelledby="report-dispatches"
              onKeyDown={(event) => {
                const viewport = event.currentTarget;
                if (event.target !== viewport || viewport.scrollWidth <= viewport.clientWidth) return;
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                viewport.scrollBy(event.key === "ArrowRight" ? 80 : -80, 0);
              }}
            >
              <table className={styles.table} aria-labelledby="report-dispatches">
                <thead>
                  <tr>
                    {selectable && <th scope="col">Selección</th>}
                    {columns.map((column) => (
                      <th key={column} scope="col" className={numericColumns.has(column) ? styles.numeric : undefined}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>{visible}</tbody>
              </table>
            </div>
          </section>
        </MotionSwap>
      </div>

      {results.length > PAGE_SIZE && (
        <Pagination page={currentPage + 1} pageSize={PAGE_SIZE} total={results.length} onPageChange={(next) => setPage(next - 1)} itemLabel="despachos" ariaLabel={paginationLabel} className="mt-4 border border-border" />
      )}
    </>
  );
}
