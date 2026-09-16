"use client";

import { motion, useReducedMotion } from "motion/react";

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
  const reduceMotion = useReducedMotion();

  if (disableMotion || reduceMotion) {
    return <motion.section className={className} style={style} initial={false} {...props}>{children}</motion.section>;
  }

  return (
    <motion.section
      className={className}
      style={style}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px 0px" }}
      {...props}
    >
      {children}
    </motion.section>
  );
}
