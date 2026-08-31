"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function AuditError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-4xl">
      <ErrorState
        title="No pudimos cargar la auditoría"
        description="No fue posible consultar los eventos globales. Intenta nuevamente."
        onRetry={reset}
      />
    </div>
  );
}
