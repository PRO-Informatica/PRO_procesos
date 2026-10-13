"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sileo";

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  const sileoTheme = resolvedTheme === "dark" || resolvedTheme === "light"
    ? resolvedTheme
    : "system";

  return (
    <Toaster
      position="top-center"
      offset={{ top: "max(80px, env(safe-area-inset-top))", right: 12, left: 12 }}
      theme={sileoTheme}
      options={{ roundness: 14, duration: 4000 }}
    />
  );
}
