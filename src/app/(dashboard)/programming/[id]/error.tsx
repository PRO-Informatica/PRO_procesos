"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function ProgrammingDetailError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <ErrorState
        title="No pudimos abrir esta programación"
        description="Verifica que siga disponible en el proyecto activo e intenta nuevamente."
        onRetry={reset}
      />
    </div>
  );
}
