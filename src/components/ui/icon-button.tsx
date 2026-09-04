"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

import { cn } from "@/lib/class-names";
import { motionTokens } from "@/lib/motion/tokens";

import { Tooltip } from "./tooltip";

export const IconButton = forwardRef<HTMLButtonElement, HTMLMotionProps<"button"> & {
  label: string;
  tone?: "neutral" | "destructive";
  tooltipSide?: "top" | "bottom";
}>(function IconButton({ label, tone = "neutral", tooltipSide, className, type = "button", ...props }, ref) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <motion.button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "icon-button",
          tone === "destructive" && "text-destructive hover:bg-destructive-soft",
          className,
        )}
        whileHover={props.disabled ? undefined : { y: -1 }}
        whileTap={props.disabled ? undefined : { scale: motionTokens.scale.press }}
        transition={{ duration: motionTokens.duration.hover, ease: motionTokens.ease }}
        {...props}
      />
    </Tooltip>
  );
});
