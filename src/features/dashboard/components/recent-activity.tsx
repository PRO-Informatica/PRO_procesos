"use client";

import { Pagination } from "@/components/ui/pagination";
import { ArrowRight, History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { MotionSwap } from "@/components/motion/motion-swap";

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
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border p-4 sm:p-5">
        <History className="size-4 text-brand-strong" />
        <h2 className="font-semibold text-foreground">Actividad reciente</h2>
      </header>

      <div className="overflow-hidden">
        <MotionSwap motionKey={currentPage} className="divide-y divide-border">
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
        </MotionSwap>
      </div>

      {items.length > PAGE_SIZE && (
        <Pagination page={currentPage + 1} pageSize={PAGE_SIZE} total={items.length} onPageChange={(next) => setPage(next - 1)} itemLabel="actividades" ariaLabel="Paginación de actividad reciente" className="border-t border-border" />
      )}
    </section>
  );
}
