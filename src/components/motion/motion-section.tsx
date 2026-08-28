"use client";

import { motion } from "motion/react";

import { fadeUp } from "@/lib/motion/variants";

export function MotionSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section className={className} variants={fadeUp}>
      {children}
    </motion.section>
  );
}
