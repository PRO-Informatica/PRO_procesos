"use client";

import { createContext, useContext } from "react";

import type { PlatformContextData } from "./types";

const PlatformContext = createContext<PlatformContextData | null>(null);

export function PlatformProvider({
  value,
  children,
}: {
  value: PlatformContextData;
  children: React.ReactNode;
}) {
  return (
    <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
  );
}

export function usePlatformContext() {
  const context = useContext(PlatformContext);

  if (!context) {
    throw new Error("usePlatformContext debe utilizarse dentro de PlatformProvider.");
  }

  return context;
}
