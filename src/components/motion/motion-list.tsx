"use client";

import { motion } from "motion/react";

import { fadeUp, staggerContainer } from "@/lib/motion/variants";

export function MotionList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerContainer}>
      {children}
    </motion.div>
  );
}

export function MotionItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={fadeUp}>
      {children}
    </motion.div>
  );
}
