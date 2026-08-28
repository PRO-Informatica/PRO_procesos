"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function PlatformUsersError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-4xl">
      <ErrorState
        description="No fue posible cargar la administración global de usuarios. Intenta nuevamente."
        onRetry={reset}
      />
    </div>
  );
}
