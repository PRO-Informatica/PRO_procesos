"use client";

import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";

export function AnimatedProgress({
  value,
  label,
  className = "",
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const normalized = Math.min(100, Math.max(0, value));

  return (
    <div
      className={`h-3 overflow-hidden rounded-full bg-muted ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={normalized}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full origin-left rounded-full bg-brand"
        initial={reduceMotion ? false : { scaleX: 0 }}
        animate={{ scaleX: normalized / 100 }}
        transition={{
          duration: reduceMotion ? 0 : motionTokens.duration.progress,
          ease: motionTokens.ease,
        }}
      />
    </div>
  );
}
