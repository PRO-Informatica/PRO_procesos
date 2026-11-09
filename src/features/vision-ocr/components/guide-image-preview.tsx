"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function GuideImagePreview({ src, alt }: { src: string; alt: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  return <div className="mt-3 min-w-0 space-y-3">
    {expanded && <div className="flex flex-wrap items-center gap-2" aria-label="Controles de imagen">
      <Button variant="secondary" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} disabled={zoom <= 1}>Alejar</Button>
      <span className="text-xs" aria-live="polite">{zoom * 100}%</span>
      <Button variant="secondary" onClick={() => setZoom((value) => Math.min(3, value + 0.5))} disabled={zoom >= 3}>Acercar</Button>
      <Button variant="secondary" onClick={() => { setExpanded(false); setZoom(1); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }}>Cerrar ampliación</Button>
    </div>}
    {expanded ? <div className="max-h-[65dvh] overflow-auto rounded-lg border border-border bg-muted p-2" tabIndex={0} role="region" aria-label="Imagen ampliada de la guía">
      {/* Local blobs and signed originals are displayed without transformation. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} />
    </div> : <button ref={trigger} type="button" className="block w-full rounded-lg focus-visible:outline-2 focus-visible:outline-brand" aria-label="Ampliar foto de la guía" onClick={() => setExpanded(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-80 w-full object-contain" />
      <span className="mt-2 block text-xs text-foreground-muted">Pulsa la imagen para ampliarla aquí.</span>
    </button>}
  </div>;
}
