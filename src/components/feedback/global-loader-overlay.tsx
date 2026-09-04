"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { createPortal } from "react-dom";

import type { GlobalLoadingState } from "./global-loading-provider";
import { motionTokens } from "@/lib/motion/tokens";

export function GlobalLoaderOverlay({
  state,
}: {
  state: GlobalLoadingState | null;
}) {
  const reducedMotion = useReducedMotion();

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          className="fixed inset-0 z-[9999] grid cursor-wait place-items-center bg-black/35 p-4 backdrop-blur-[2px]"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : motionTokens.duration.hover }}
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={state.label}
        >
          <motion.div
            className="w-full max-w-xs rounded-2xl border border-border bg-surface px-6 py-7 text-center shadow-2xl"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, scale: 0.99 }}
            transition={{ duration: reducedMotion ? 0 : motionTokens.duration.hover }}
          >
            <motion.div
              className="mx-auto grid size-20 place-items-center rounded-2xl border border-white/8 bg-sidebar shadow-sm"
              animate={reducedMotion ? undefined : { scale: [1, 1.025, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/pro-logo.png"
                alt=""
                width={112}
                height={56}
                className="h-auto w-16"
                priority
              />
            </motion.div>
            <p className="mt-5 text-sm font-semibold text-foreground">{state.label}</p>
            {state.description && (
              <p className="mt-1.5 text-xs leading-5 text-foreground-muted">
                {state.description}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
