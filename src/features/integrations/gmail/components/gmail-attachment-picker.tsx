"use client";

import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GMAIL_ATTACHMENT_ACCEPT,
  GMAIL_MAX_ATTACHMENT_COUNT,
  GMAIL_MAX_TOTAL_ATTACHMENT_BYTES,
} from "../attachment-constants";

const MIME_BY_EXTENSION = new Map([
  [".pdf", "application/pdf"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".csv", "text/csv"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

export type SelectedGmailAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(file: File) {
  if (file.type.startsWith("image/")) return FileImage;
  if (/spreadsheet|excel|csv/iu.test(file.type)) return FileSpreadsheet;
  return FileText;
}

function validateClientFile(file: File, maxBytes: number) {
  const expectedMime = MIME_BY_EXTENSION.get(extensionOf(file.name));
  if (!expectedMime || expectedMime !== file.type) {
    return `${file.name}: el tipo o extensión no está permitido.`;
  }
  if (file.size === 0) return `${file.name}: el archivo está vacío.`;
  if (maxBytes <= 0) return "Los adjuntos no están configurados para este ambiente.";
  if (file.size > maxBytes) return `${file.name}: supera el límite por archivo.`;
  return null;
}

export function GmailAttachmentPicker({
  disabled,
  maxBytes,
  onChange,
  selected,
}: {
  disabled?: boolean;
  maxBytes: number;
  onChange: (files: SelectedGmailAttachment[]) => void;
  selected: SelectedGmailAttachment[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(selected);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canScrollBackward, setCanScrollBackward] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateCarouselControls = useCallback(() => {
    const carousel = carouselRef.current;
    if (!carousel) {
      setCanScrollBackward(false);
      setCanScrollForward(false);
      return;
    }
    const maximum = carousel.scrollWidth - carousel.clientWidth;
    setCanScrollBackward(carousel.scrollLeft > 2);
    setCanScrollForward(maximum > 2 && carousel.scrollLeft < maximum - 2);
  }, []);

  useEffect(() => {
    currentRef.current = selected;
  }, [selected]);

  useEffect(() => () => {
    for (const attachment of currentRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateCarouselControls);
    window.addEventListener("resize", updateCarouselControls);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateCarouselControls);
    };
  }, [selected.length, updateCarouselControls]);

  function moveCarousel(direction: -1 | 1) {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollBy({
      left: direction * carousel.clientWidth * 0.82,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  async function addFiles(files: File[]) {
    if (disabled || files.length === 0) return;
    setPreparing(true);
    setError(null);
    await Promise.resolve();
    try {
      if (selected.length + files.length > GMAIL_MAX_ATTACHMENT_COUNT) {
        setError(`Puedes adjuntar como máximo ${GMAIL_MAX_ATTACHMENT_COUNT} archivos.`);
        return;
      }
      const validationError = files
        .map((file) => validateClientFile(file, maxBytes))
        .find(Boolean);
      if (validationError) {
        setError(validationError);
        return;
      }
      const total = [...selected.map((item) => item.file), ...files]
        .reduce((sum, file) => sum + file.size, 0);
      if (total > GMAIL_MAX_TOTAL_ATTACHMENT_BYTES) {
        setError("El tamaño total de los adjuntos supera 15 MB.");
        return;
      }
      onChange([
        ...selected,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        })),
      ]);
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeFile(id: string) {
    const target = selected.find((item) => item.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(selected.filter((item) => item.id !== id));
    setError(null);
  }

  const totalBytes = selected.reduce((sum, item) => sum + item.file.size, 0);

  return (
    <div
      className={`space-y-3 rounded-xl border p-3 transition-colors motion-reduce:transition-none ${dragging ? "border-brand bg-brand-soft/60" : "border-border bg-muted/35"}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={GMAIL_ATTACHMENT_ACCEPT}
        disabled={disabled || maxBytes <= 0}
        className="sr-only"
        onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
        aria-label="Seleccionar archivos adjuntos"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Archivos adjuntos</p>
          <p className="mt-0.5 text-xs text-foreground-muted">
            PDF, Excel, CSV o imágenes · máximo {GMAIL_MAX_ATTACHMENT_COUNT}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {selected.length > 1 && (
            <div className="flex items-center gap-1" aria-label="Controles del carrusel">
              <button
                type="button"
                onClick={() => moveCarousel(-1)}
                disabled={!canScrollBackward}
                className="grid size-10 place-items-center rounded-lg border border-border bg-surface text-foreground-muted transition-colors hover:border-brand/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                aria-label="Adjuntos anteriores"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => moveCarousel(1)}
                disabled={!canScrollForward}
                className="grid size-10 place-items-center rounded-lg border border-border bg-surface text-foreground-muted transition-colors hover:border-brand/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                aria-label="Adjuntos siguientes"
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={disabled || maxBytes <= 0}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:border-brand/30 hover:bg-brand-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {dragging ? <UploadCloud aria-hidden="true" className="size-4 text-brand" /> : <Paperclip aria-hidden="true" className="size-4" />}
            {preparing ? "Preparando adjuntos…" : dragging ? "Suelta los archivos" : "Adjuntar"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {selected.length > 0 && (
        <div className="space-y-2">
          <div
            ref={carouselRef}
            role="region"
            aria-roledescription="carrusel"
            aria-label="Archivos seleccionados"
            tabIndex={0}
            onScroll={updateCarouselControls}
            className="flex touch-pan-x snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {selected.map((attachment) => {
              const Icon = iconFor(attachment.file);
              return (
                <div key={attachment.id} className="flex min-w-0 basis-[85%] shrink-0 snap-start items-center gap-3 rounded-lg border border-border bg-surface px-2.5 py-2 shadow-[0_1px_2px_rgba(16,24,40,0.03)] sm:basis-[calc(50%-0.25rem)]">
                  {attachment.previewUrl ? (
                    <Image
                      unoptimized
                      src={attachment.previewUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="size-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded bg-muted text-foreground-muted"><Icon aria-hidden="true" className="size-5" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={attachment.file.name}>{attachment.file.name}</p>
                    <p className="truncate text-xs text-foreground-muted">{extensionOf(attachment.file.name).slice(1).toUpperCase()} · {formatBytes(attachment.file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(attachment.id)}
                    disabled={disabled}
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-destructive-soft hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    aria-label={`Eliminar ${attachment.file.name}`}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-foreground-muted" aria-live="polite">
            {selected.length} de {GMAIL_MAX_ATTACHMENT_COUNT} archivo(s) · {formatBytes(totalBytes)} en total
          </p>
        </div>
      )}
    </div>
  );
}
