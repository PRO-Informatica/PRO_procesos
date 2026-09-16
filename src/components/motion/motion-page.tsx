"use client";

import { motion, useReducedMotion } from "motion/react";

import { pageTransition } from "@/lib/motion/variants";

export function MotionPage({
  children,
  className,
  disableMotion = false,
}: {
  children: React.ReactNode;
  className?: string;
  disableMotion?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (disableMotion || reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={pageTransition}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}
