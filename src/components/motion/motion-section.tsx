"use client";

import { motion } from "motion/react";

import { fadeUp } from "@/lib/motion/variants";

export function MotionSection({
  children,
  className,
  style,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
} & Omit<React.ComponentPropsWithoutRef<typeof motion.section>, "children" | "className" | "style">) {
  return (
    <motion.section className={className} style={style} variants={fadeUp} {...props}>
      {children}
    </motion.section>
  );
}
