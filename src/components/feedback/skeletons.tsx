"use client";

import { motion } from "motion/react";

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <motion.div
      className={`rounded-md bg-border/75 ${className}`}
      animate={{ opacity: [0.55, 0.9, 0.55] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5" aria-hidden="true">
      <SkeletonLine className="size-10 rounded-lg" />
      <SkeletonLine className="mt-5 h-4 w-2/3" />
      <SkeletonLine className="mt-3 h-3 w-full" />
      <SkeletonLine className="mt-2 h-3 w-4/5" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" aria-hidden="true">
      <div className="grid grid-cols-4 gap-4 border-b border-border bg-muted p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonLine key={index} className="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="grid grid-cols-4 gap-4 border-b border-border p-4 last:border-0">
          {Array.from({ length: 4 }).map((__, column) => (
            <SkeletonLine key={column} className="h-3" />
          ))}
        </div>
      ))}
    </div>
  );
}
