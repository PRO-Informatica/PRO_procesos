export const motionTokens = {
  duration: {
    instant: 0.12,
    hover: 0.18,
    route: 0.25,
    content: 0.35,
    section: 0.42,
    progress: 0.9,
  },
  distance: {
    route: 6,
    content: 10,
    exit: -4,
  },
  scale: {
    dialog: 0.97,
    popover: 0.98,
    press: 0.985,
  },
  stagger: 0.06,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;
