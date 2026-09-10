"use client";

import { motion } from "motion/react";

import { fadeUp } from "@/lib/motion/variants";

export function MotionSection({
  children,
  className,
  style,
  disableMotion = false,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  disableMotion?: boolean;
} & Omit<React.ComponentPropsWithoutRef<typeof motion.section>, "children" | "className" | "style">) {
  if (disableMotion) {
    return <section className={className} style={style}>{children}</section>;
  }

  return (
    <motion.section className={className} style={style} variants={fadeUp} {...props}>
      {children}
    </motion.section>
  );
}
