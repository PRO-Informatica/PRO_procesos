"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <ErrorState onRetry={reset} />;
}
