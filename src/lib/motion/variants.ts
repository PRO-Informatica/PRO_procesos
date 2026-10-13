import type { Variants } from "motion/react";
import { motionTokens } from "./tokens";

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: motionTokens.duration.route } },
  exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.content },
  visible: { opacity: 1, y: 0, transition: { duration: motionTokens.duration.content, ease: motionTokens.ease } },
  exit: { opacity: 0, y: motionTokens.distance.exit, transition: { duration: motionTokens.duration.instant } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: motionTokens.scale.popover },
  visible: { opacity: 1, scale: 1, transition: { duration: motionTokens.duration.content, ease: motionTokens.ease } },
  exit: { opacity: 0, scale: 0.99, transition: { duration: motionTokens.duration.instant } },
};

export const panelTransition: Variants = {
  hidden: { opacity: 0, x: motionTokens.distance.content },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: motionTokens.duration.content, ease: motionTokens.ease },
  },
  exit: {
    opacity: 0,
    x: motionTokens.distance.exit,
    transition: { duration: motionTokens.duration.instant, ease: motionTokens.ease },
  },
};

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.route },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: motionTokens.duration.route,
      ease: motionTokens.ease,
    },
  },
  exit: { opacity: 0, y: motionTokens.distance.exit, transition: { duration: motionTokens.duration.instant } },
};
