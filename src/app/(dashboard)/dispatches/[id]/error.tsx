"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function DispatchDetailError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-3xl"><ErrorState title="No pudimos abrir este despacho" description="Verifica que pertenezca al proyecto activo e intenta nuevamente." onRetry={reset} /></div>;
}
