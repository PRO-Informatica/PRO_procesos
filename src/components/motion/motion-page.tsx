"use client";

import { motion } from "motion/react";

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
  if (disableMotion) return <div className={className}>{children}</div>;

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
