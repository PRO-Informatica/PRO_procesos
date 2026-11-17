"use client";

import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";

export function AnimatedProgress({
  value,
  label,
  className = "",
  continuous = false,
}: {
  value: number;
  label: string;
  className?: string;
  continuous?: boolean;
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
        className="relative h-full origin-left overflow-hidden rounded-full bg-brand"
        initial={reduceMotion ? false : { scaleX: 0 }}
        animate={{ scaleX: normalized / 100 }}
        transition={{
          duration: reduceMotion ? 0 : motionTokens.duration.progress,
          ease: motionTokens.ease,
        }}
      >
        {continuous && !reduceMotion && <motion.span aria-hidden="true" className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent"
          initial={{ x: "0%" }} animate={{ x: ["0%", "300%"] }} transition={{ duration: 3.5, repeatDelay: 2, repeat: Infinity, ease: "linear" }} />}
      </motion.div>
    </div>
  );
}
