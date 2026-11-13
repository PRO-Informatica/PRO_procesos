import { getProgrammingDisplayStatus } from "./status-presentation";

export const PROGRAMMING_COLOR_STATES = [
  "CONFIRMED",
  "IN_EXECUTION",
  "DISPATCH_COMPLETED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;

type ProgrammingColorStatus = (typeof PROGRAMMING_COLOR_STATES)[number];

// CSS owns the palette for both app themes, keeping calendar, badges and legend
// consistent even when the device's color preference differs from the app.
export function programmingColorVariables(status: ProgrammingColorStatus, residentView = false) {
  const prefix = residentView && getProgrammingDisplayStatus(status, true) === "DISPATCH_COMPLETED"
    ? "--programming-resident-dispatch-completed"
    : `--programming-${status.toLowerCase().replaceAll("_", "-")}`;
  return {
    main: `var(${prefix}-main)`,
    container: `var(${prefix}-bg)`,
    onContainer: `var(${prefix}-fg)`,
  };
}
