"use client";

import { Toaster } from "sileo";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      offset={{ top: 16, right: 16, left: 16 }}
      theme="system"
      options={{ roundness: 14, duration: 3000 }}
    />
  );
}
