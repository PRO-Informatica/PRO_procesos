"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function BatchesError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-3xl"><ErrorState title="No pudimos cargar los lotes" description="Verifica tu acceso al proyecto e intenta nuevamente." onRetry={reset} /></div>;
}
