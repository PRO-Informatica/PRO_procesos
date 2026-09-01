"use client";

import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useFormStatus } from "react-dom";

export function LoadingButton({
  children,
  loadingLabel = "Procesando…",
  className = "primary-button",
  disabled = false,
}: {
  children: React.ReactNode;
  loadingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      className={className}
      disabled={pending || disabled}
      type="submit"
      whileTap={pending || reduceMotion ? undefined : { scale: 0.985 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={pending ? "loading" : "idle"}
          className="inline-flex items-center justify-center gap-2"
          initial={reduceMotion ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -3 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.14 }}
        >
          {pending && <LoaderCircle aria-hidden="true" className={`size-4 ${reduceMotion ? "" : "animate-spin"}`} />}
          {pending ? loadingLabel : children}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
