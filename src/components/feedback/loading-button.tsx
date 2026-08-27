"use client";

import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useFormStatus } from "react-dom";

export function LoadingButton({
  children,
  loadingLabel = "Procesando…",
  className = "primary-button",
}: {
  children: React.ReactNode;
  loadingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <motion.button
      className={className}
      disabled={pending}
      type="submit"
      whileTap={pending ? undefined : { scale: 0.985 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={pending ? "loading" : "idle"}
          className="inline-flex items-center justify-center gap-2"
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.14 }}
        >
          {pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {pending ? loadingLabel : children}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
