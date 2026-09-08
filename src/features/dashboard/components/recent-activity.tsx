"use client";

import { ArrowRight, ChevronLeft, ChevronRight, History } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import type { DashboardActivity } from "../types";
import { formatDashboardActivity, formatDashboardDateTime } from "../formatters";

const PAGE_SIZE = 3;

function activityHref(type: string, id: string) {
  if (type === "dispatch" || type === "dispatch_guide") return `/dispatches/${id}`;
  if (type === "programming") return `/programming/${id}`;
  if (type === "invoice") return "/invoices";
  if (type === "reconciliation_order") return "/reconciliation";
  return "/reports";
}

export function RecentActivity({
  items,
  timezone,
}: {
  items: DashboardActivity[];
  timezone: string;
}) {
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const visibleItems = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border p-4 sm:p-5">
        <History className="size-4 text-brand-strong" />
        <h2 className="font-semibold text-foreground">Actividad reciente</h2>
      </header>

      <div className="overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="divide-y divide-border"
            initial={reduceMotion ? false : { opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {visibleItems.length ? (
              visibleItems.map((item) => (
                <Link
                  href={activityHref(item.entityType, item.entityId)}
                  key={item.id}
                  className="flex min-h-16 items-start gap-3 p-4 transition-colors hover:bg-muted/40"
                >
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {formatDashboardActivity(item.action)}
                    </span>
                    <span className="mt-1 block truncate text-xs text-foreground-muted">
                      {item.actorName} · {formatDashboardDateTime(item.createdAt, timezone)}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-foreground-muted" />
                </Link>
              ))
            ) : (
              <p className="p-6 text-center text-sm text-foreground-muted">
                Sin actividad reciente.
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length > PAGE_SIZE && (
        <footer className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[11px] font-medium text-foreground-muted">
            Página {page + 1} de {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
              className="grid size-9 place-items-center rounded-lg border border-border text-foreground-muted transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
              aria-label="Ver actividades anteriores"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={page >= pageCount - 1}
              className="grid size-9 place-items-center rounded-lg border border-border text-foreground-muted transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
              aria-label="Ver más actividades"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
