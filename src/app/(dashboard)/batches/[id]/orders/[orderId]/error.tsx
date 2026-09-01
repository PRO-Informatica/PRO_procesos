"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <div className="mx-auto max-w-xl rounded-2xl border border-destructive/20 bg-surface p-8 text-center"><h1 className="text-xl font-semibold">No se pudo cargar la conciliación</h1><p className="mt-2 text-sm text-foreground-muted">Reintenta; no se modificaron datos.</p><button className="primary-button mt-5" onClick={reset}>Reintentar</button></div>;
}
