"use client";

import { motion } from "motion/react";

import { fadeUp } from "@/lib/motion/variants";

export function MotionSection({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <motion.section className={className} style={style} variants={fadeUp}>
      {children}
    </motion.section>
  );
}
