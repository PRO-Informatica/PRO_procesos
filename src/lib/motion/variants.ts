import type { Variants } from "motion/react";

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0 },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24 } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.14 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.99 },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.035,
      delayChildren: 0.025,
    },
  },
};

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};
