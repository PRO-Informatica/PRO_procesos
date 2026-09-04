"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

import { cn } from "@/lib/class-names";
import { motionTokens } from "@/lib/motion/tokens";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

export const buttonVariantClass: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  destructive: "destructive-button",
  ghost: "ghost-button",
};

export const Button = forwardRef<HTMLButtonElement, HTMLMotionProps<"button"> & {
  variant?: ButtonVariant;
}>(function Button({ variant = "primary", className, type = "button", ...props }, ref) {
  return (
    <motion.button
      ref={ref}
      type={type}
      className={cn(buttonVariantClass[variant], className)}
      whileHover={props.disabled ? undefined : { y: -1 }}
      whileTap={props.disabled ? undefined : { scale: motionTokens.scale.press }}
      transition={{ duration: motionTokens.duration.hover, ease: motionTokens.ease }}
      {...props}
    />
  );
});
