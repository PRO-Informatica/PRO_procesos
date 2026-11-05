"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { guidePdfThumbnails, type GuideSource } from "../guide-sources";

export function GuidePagePicker({ sources, disabled, onAccept, onCancel }: {
  sources: GuideSource[]; disabled: boolean;
  onAccept: (selected: GuideSource[]) => void; onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void guidePdfThumbnails(sources[0].file, (page, preview) => {
      setPreviews((current) => ({ ...current, [page]: preview }));
    }, () => cancelled).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudieron mostrar las miniaturas."); });
    return () => { cancelled = true; };
  }, [sources]);
  return <div className="space-y-4 rounded-xl border border-border bg-surface p-3 sm:p-4" aria-labelledby="guide-pages-title">
    <div>
      <h4 id="guide-pages-title" className="font-semibold">Elige las páginas con guías de despacho</h4>
      <p className="mt-1 break-words text-sm text-foreground-muted">{sources[0].file.name} · {sources.length} página(s)</p>
      <p className="mt-2 text-xs leading-5 text-foreground-muted">Selecciona una guía por página. Omite los documentos Pedido / Control de operación: su lectura de servicios queda pendiente. Esta selección no consume OCR.</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-sm font-semibold">{selected.length} guía(s) seleccionada(s) de {sources.length} páginas</p>
      <Button variant="ghost" disabled={disabled} onClick={() => setSelected(selected.length === sources.length ? [] : sources.map((source) => source.id))}>{selected.length === sources.length ? "Quitar selección" : "Seleccionar todas"}</Button>
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Páginas del PDF">
      {sources.map((source) => <label key={source.id} className={`flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 ${selected.includes(source.id) ? "border-brand bg-brand-soft" : "border-border bg-muted/30"}`}>
        <span className="flex min-h-11 items-center gap-2 p-2 text-sm font-semibold"><input type="checkbox" aria-label={`Seleccionar página ${source.pageNumber}`} disabled={disabled} checked={selected.includes(source.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} />Página {source.pageNumber}</span>
        <span className="grid aspect-[3/4] place-items-center bg-muted/30 p-1">
          {/* Local PDF raster, no remote image optimization or OCR. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {previews[source.pageNumber!] ? <img src={previews[source.pageNumber!]} alt={`Miniatura de página ${source.pageNumber}`} className="h-full max-h-64 w-full object-contain" /> : <span className="px-2 text-center text-xs text-foreground-muted">Preparando miniatura…</span>}
        </span>
      </label>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={disabled || selected.length === 0} onClick={() => onAccept(sources.filter((source) => selected.includes(source.id)))}>Continuar con {selected.length} guía(s)</Button><Button variant="secondary" disabled={disabled} onClick={onCancel}>Cancelar selección</Button></div>
  </div>;
}
