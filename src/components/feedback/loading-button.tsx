"use client";

import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/class-names";
import { motionTokens } from "@/lib/motion/tokens";

import { buttonVariantClass, type ButtonVariant } from "@/components/ui/button";

export function LoadingButton({
  children,
  loadingLabel = "Procesando…",
  className,
  variant = "primary",
  disabled = false,
  loading = false,
  type = "submit",
  ...props
}: Omit<React.ComponentProps<typeof motion.button>, "type" | "children"> & {
  children: React.ReactNode;
  loadingLabel?: string;
  variant?: ButtonVariant;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
}) {
  const { pending: formPending } = useFormStatus();
  const pending = loading || formPending;
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      className={cn(buttonVariantClass[variant], className)}
      disabled={pending || disabled}
      type={type}
      aria-busy={pending}
      whileTap={pending || reduceMotion ? undefined : { scale: motionTokens.scale.press }}
      {...props}
    >
      <span className="grid place-items-center">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-2">{children}</span>
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-2"><span className="size-4" />{loadingLabel}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={pending ? "loading" : "idle"}
            className="col-start-1 row-start-1 inline-flex items-center justify-center gap-2"
            initial={reduceMotion ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -3 }}
            transition={reduceMotion ? { duration: 0 } : { duration: motionTokens.duration.instant }}
          >
            {pending && <LoaderCircle aria-hidden="true" className={`size-4 ${reduceMotion ? "" : "animate-spin"}`} />}
            {pending ? loadingLabel : children}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
