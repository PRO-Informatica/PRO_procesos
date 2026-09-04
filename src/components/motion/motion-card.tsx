"use client";

import { motion } from "motion/react";

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
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      whileHover={interactive ? { y: -2 } : undefined}
      whileTap={interactive ? { scale: 0.995 } : undefined}
      transition={{ duration: motionTokens.duration.hover, ease: motionTokens.ease }}
    >
      {children}
    </motion.div>
  );
}
