import type { Variants } from "motion/react";
import { motionTokens } from "./tokens";

export const fadeIn: Variants = {
  hidden: { opacity: 0.82 },
  visible: { opacity: 1, transition: { duration: motionTokens.duration.route } },
  exit: { opacity: 0 },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0.72, y: motionTokens.distance.content },
  visible: { opacity: 1, y: 0, transition: { duration: motionTokens.duration.content, ease: motionTokens.ease } },
  exit: { opacity: 0, y: motionTokens.distance.exit, transition: { duration: motionTokens.duration.instant } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: motionTokens.scale.popover },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.99 },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: motionTokens.stagger,
      delayChildren: motionTokens.duration.instant / 2,
    },
  },
};

export const pageTransition: Variants = {
  hidden: { opacity: 0.88 },
  visible: {
    opacity: 1,
    transition: {
      duration: motionTokens.duration.route,
      ease: motionTokens.ease,
      staggerChildren: motionTokens.stagger,
      delayChildren: motionTokens.duration.instant / 2,
    },
  },
  exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } },
};
