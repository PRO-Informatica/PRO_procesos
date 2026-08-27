"use client";

import { LoaderCircle } from "lucide-react";
import { motion } from "motion/react";

export function SectionLoader({ label = "Cargando…" }: { label?: string }) {
  return (
    <motion.div
      className="flex min-h-32 items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/50 px-4 text-sm text-foreground-muted"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
      aria-live="polite"
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </motion.div>
  );
}
