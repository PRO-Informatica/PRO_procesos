"use client";

import { FileImage, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { guideSourceLabel, type GuideSource } from "../guide-sources";

async function photoThumbnail(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("No se pudo preparar la miniatura.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error("No se pudo preparar la miniatura.")), "image/jpeg", 0.75));
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close(); canvas.width = 0; canvas.height = 0;
  }
}

export function GuidePhotoQueue({ sources }: { sources: GuideSource[] }) {
  const cache = useRef(new Map<string, string | null>());
  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const urls = cache.current;
    return () => { for (const url of urls.values()) if (url) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const urls = cache.current;
    const ids = new Set(sources.map((source) => source.id));
    for (const [id, url] of urls) {
      if (!ids.has(id)) { if (url) URL.revokeObjectURL(url); urls.delete(id); }
    }
    // Small local previews, one decode at a time. Keep existing thumbnails
    // when photos are appended; never upload or run OCR for this queue.
    void (async () => {
      for (const source of sources) {
        if (cancelled) return;
        if (source.pageNumber || urls.has(source.id)) continue;
        let preview: string | null = null;
        try { preview = await photoThumbnail(source.file); } catch { /* Keep the original available for review. */ }
        if (cancelled) { if (preview) URL.revokeObjectURL(preview); return; }
        urls.set(source.id, preview);
        setPreviews(Object.fromEntries(urls));
      }
    })();
    return () => { cancelled = true; };
  }, [sources]);

  return <div className="min-w-0 space-y-2">
    <p className="text-xs font-semibold text-foreground-muted">Cola de guías ({sources.length})</p>
    <ol aria-label="Cola de guías" tabIndex={0} className="flex min-w-0 gap-2 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-brand">
      {sources.map((source, index) => <li key={source.id} aria-current={index === 0 ? "step" : undefined}
        className={`w-28 shrink-0 space-y-1 rounded-lg border-2 p-1.5 ${index === 0 ? "border-brand bg-brand-soft" : "border-border bg-muted/20"}`}>
        <div className="grid h-20 place-items-center overflow-hidden rounded bg-surface">
          {/* These small local JPEGs leave the original photo unchanged. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {previews[source.id] ? <img src={previews[source.id]!} alt={`Miniatura de foto ${index + 1}: ${source.file.name}`} width={96} height={80} className="h-20 w-full object-contain" /> :
            <span className="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-foreground-muted">
              {source.pageNumber ? <FileText aria-hidden="true" className="size-6" /> : <FileImage aria-hidden="true" className="size-6" />}
              {source.pageNumber ? `Página ${source.pageNumber}` : previews[source.id] === null ? "Vista no disponible" : "Preparando…"}
            </span>}
        </div>
        <p className={`text-[10px] font-semibold ${index === 0 ? "text-brand-strong" : "text-foreground-muted"}`}>{index + 1} · {index === 0 ? "En revisión" : "Pendiente"}</p>
        <p data-source-name className="truncate text-[10px] text-foreground-muted" title={guideSourceLabel(source)}>{guideSourceLabel(source)}</p>
      </li>)}
    </ol>
  </div>;
}
