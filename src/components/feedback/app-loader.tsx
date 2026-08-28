"use client";

import { useGlobalPending } from "./global-loading-provider";

export function AppLoader({
  label = "Cargando información…",
  description,
}: {
  label?: string;
  description?: string;
}) {
  useGlobalPending(true, label, description);
  return null;
}

export function PageLoader({ label }: { label?: string }) {
  return <AppLoader label={label} />;
}
