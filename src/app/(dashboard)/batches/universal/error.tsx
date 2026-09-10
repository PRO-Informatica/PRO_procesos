"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function UniversalBatchesError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-3xl"><ErrorState title="No pudimos cargar Lotes Universal" description="Verifica tus accesos e intenta nuevamente." onRetry={reset} /></div>;
}
