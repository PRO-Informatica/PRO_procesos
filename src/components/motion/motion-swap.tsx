"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { panelTransition } from "@/lib/motion/variants";

export function MotionSwap({
  motionKey,
  children,
  className,
}: {
  motionKey: string | number;
  children: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={motionKey}
        className={className}
        variants={panelTransition}
        initial={reduceMotion ? false : "hidden"}
        animate="visible"
        exit={reduceMotion ? undefined : "exit"}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
