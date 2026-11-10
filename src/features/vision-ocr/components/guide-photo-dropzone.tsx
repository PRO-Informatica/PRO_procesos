"use client";

import { FileImage, UploadCloud } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clipboardGuideImages } from "../guide-photo-intake";

export function GuidePhotoDropzone({ disabled, onFiles }: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const helpId = useId();

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const root = rootRef.current;
      const scope = root?.closest('[role="dialog"], dialog') ?? root;
      const target = event.target instanceof Element ? event.target : null;
      // Only the visible guide dialog owns this paste, even when a field or
      // its heading has focus. Nested dialogs and text pastes keep their owner.
      if (disabled || !root?.getClientRects().length || !scope || !target ||
          !scope.contains(target) || (target.closest('[role="dialog"], dialog') ?? root) !== scope ||
          event.defaultPrevented || !event.clipboardData) return;
      const photos = clipboardGuideImages(event.clipboardData);
      if (!photos.length) return;
      event.preventDefault();
      onFiles(photos);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [disabled, onFiles]);

  return <div ref={rootRef} role="group" aria-label="Cargar fotos de guías" aria-describedby={helpId}
    aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    className={`flex min-w-0 flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${disabled ? "border-border bg-muted/30 text-foreground-muted" : dragging ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand"}`}
    onDragEnter={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      if (!disabled) { dragDepth.current++; setDragging(true); }
    }}
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    }}
    onDragLeave={(event) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }}
    onDrop={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current = 0; setDragging(false);
      if (!disabled) onFiles(Array.from(event.dataTransfer.files));
    }}>
    <UploadCloud aria-hidden="true" className="size-8 text-foreground-muted" />
    <p className="text-sm font-semibold">{dragging && !disabled ? "Suelta las fotos aquí" : "Arrastra tus fotos aquí o pega una imagen"}</p>
    <div id={helpId} className="max-w-lg space-y-1 text-xs leading-5 text-foreground-muted">
      <p>Desde WhatsApp: copia la imagen y pega con Ctrl + V o ⌘ + V. Puedes elegir varias fotos a la vez.</p>
      <p>JPG, PNG o WEBP · 10 MiB por foto · Hasta 20 fotos o páginas en cola.</p>
    </div>
    <Button variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}><FileImage aria-hidden="true" className="size-4" />Subir fotos</Button>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
      aria-label="Elegir foto de guía" disabled={disabled}
      onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
  </div>;
}
