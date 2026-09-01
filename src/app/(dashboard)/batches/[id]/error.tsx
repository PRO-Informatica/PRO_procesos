"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function BatchDetailError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-3xl"><ErrorState title="No pudimos cargar el lote" description="Actualiza la información e intenta nuevamente." onRetry={reset} /></div>;
}
