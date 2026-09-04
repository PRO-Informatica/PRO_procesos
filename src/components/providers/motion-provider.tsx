"use client";

import { MotionConfig } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: motionTokens.duration.route, ease: motionTokens.ease }}
    >
      {children}
    </MotionConfig>
  );
}
