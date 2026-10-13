export const motionTokens = {
  duration: {
    instant: 0.12,
    hover: 0.16,
    route: 0.22,
    content: 0.22,
    section: 0.22,
    progress: 0.9,
  },
  distance: {
    route: 8,
    content: 10,
    exit: -8,
  },
  scale: {
    dialog: 0.97,
    popover: 0.98,
    press: 0.985,
  },
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;
