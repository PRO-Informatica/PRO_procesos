"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";

export function ErrorState({
  title = "No pudimos cargar la información",
  description = "Ocurrió un problema inesperado. Intenta nuevamente.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <motion.div
      className="rounded-xl border border-destructive/20 bg-destructive-soft px-6 py-10 text-center"
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      role="alert"
    >
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-surface text-destructive">
        <TriangleAlert aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-4 font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-foreground-muted">
        {description}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Reintentar
        </button>
      )}
    </motion.div>
  );
}
