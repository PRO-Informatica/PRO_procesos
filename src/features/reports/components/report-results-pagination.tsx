"use client";

import { Children, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const PAGE_SIZE = 8;

export function ReportResultsPagination({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState(0);
  const items = Children.toArray(children);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstItem = currentPage * PAGE_SIZE;
  const visibleItems = items.slice(firstItem, firstItem + PAGE_SIZE);

  return (
    <>
      <div className="overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentPage}
            className="space-y-3"
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          >
            {visibleItems}
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length > PAGE_SIZE && (
        <nav
          className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Paginación de resultados de reportería"
        >
          <p className="text-xs text-foreground-muted">
            Mostrando <strong className="font-semibold text-foreground">{firstItem + 1}–{Math.min(firstItem + PAGE_SIZE, items.length)}</strong> de {items.length} programaciones
          </p>

          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs font-medium text-foreground-muted">
              Página {currentPage + 1} de {pageCount}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="grid size-10 place-items-center rounded-lg border border-border text-foreground-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:opacity-35"
                aria-label="Ver página anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                disabled={currentPage === pageCount - 1}
                className="grid size-10 place-items-center rounded-lg border border-border text-foreground-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:opacity-35"
                aria-label="Ver página siguiente"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </nav>
      )}
    </>
  );
}
