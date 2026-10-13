"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps, useReducedMotion } from "motion/react";

import { cn } from "@/lib/class-names";
import { motionTokens } from "@/lib/motion/tokens";

export type ButtonVariant = "primary" | "secondary" | "success" | "destructive" | "ghost";

export const buttonVariantClass: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  success: "success-button",
  destructive: "destructive-button",
  ghost: "ghost-button",
};

export const Button = forwardRef<HTMLButtonElement, HTMLMotionProps<"button"> & {
  variant?: ButtonVariant;
}>(function Button({ variant = "primary", className, type = "button", ...props }, ref) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      ref={ref}
      type={type}
      className={cn(buttonVariantClass[variant], className)}
      whileHover={props.disabled || reduceMotion ? undefined : { y: -1 }}
      whileTap={props.disabled || reduceMotion ? undefined : { scale: motionTokens.scale.press }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.hover, ease: motionTokens.ease }}
      {...props}
    />
  );
});
