"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function ProgrammingError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <ErrorState
        title="No pudimos abrir la planificación"
        description="Verifica el acceso al proyecto e intenta nuevamente."
        onRetry={reset}
      />
    </div>
  );
}
