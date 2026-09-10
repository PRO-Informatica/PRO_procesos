"use client";

import { Toaster } from "sileo";

export function AppToaster() {
  return (
    <Toaster
      position="bottom-left"
      offset={{ bottom: "max(16px, env(safe-area-inset-bottom))", right: 16, left: 16 }}
      theme="system"
      options={{ roundness: 14, duration: 3000 }}
    />
  );
}
