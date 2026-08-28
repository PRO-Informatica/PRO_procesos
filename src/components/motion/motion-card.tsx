"use client";

import { motion } from "motion/react";

import { fadeUp } from "@/lib/motion/variants";

export function MotionCard({
  children,
  className,
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      whileHover={interactive ? { y: -2 } : undefined}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
}
