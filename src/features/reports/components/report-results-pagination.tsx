"use client";

import { Pagination } from "@/components/ui/pagination";
import { Children, useState } from "react";

import { MotionSwap } from "@/components/motion/motion-swap";

const PAGE_SIZE = 8;

export function ReportResultsPagination({ children }: { children: React.ReactNode }) {
  const [page, setPage] = useState(0);
  const items = Children.toArray(children);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstItem = currentPage * PAGE_SIZE;
  const visibleItems = items.slice(firstItem, firstItem + PAGE_SIZE);

  return (
    <>
      <div className="overflow-hidden">
        <MotionSwap motionKey={currentPage} className="space-y-3">
          {visibleItems}
        </MotionSwap>
      </div>

      {items.length > PAGE_SIZE && (
        <Pagination page={currentPage + 1} pageSize={PAGE_SIZE} total={items.length} onPageChange={(next) => setPage(next - 1)} itemLabel="programaciones" ariaLabel="Paginación de resultados de reportería" className="mt-4 border border-border" />
      )}
    </>
  );
}
