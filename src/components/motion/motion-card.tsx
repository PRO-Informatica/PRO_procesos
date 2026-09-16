"use client";

import { motion, useReducedMotion } from "motion/react";

import { fadeUp } from "@/lib/motion/variants";
import { motionTokens } from "@/lib/motion/tokens";

export function MotionCard({
  children,
  className,
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (!interactive || reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={fadeUp}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.995 }}
      transition={{ duration: motionTokens.duration.hover, ease: motionTokens.ease }}
    >
      {children}
    </motion.div>
  );
}
