"use client";

import Image from "next/image";
import {
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  const currentRef = useRef(selected);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    currentRef.current = selected;
  }, [selected]);

  useEffect(() => () => {
    for (const attachment of currentRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
  }, []);

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
    <div className="space-y-3">
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
      <button
        type="button"
        disabled={disabled || maxBytes <= 0}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(Array.from(event.dataTransfer.files));
        }}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${dragging ? "border-brand bg-brand-soft text-brand-strong" : "border-border text-foreground-muted hover:bg-muted"}`}
      >
        {dragging ? <UploadCloud aria-hidden="true" className="size-4" /> : <Paperclip aria-hidden="true" className="size-4" />}
        {preparing ? "Preparando adjuntos…" : "Adjuntar archivos o arrastrarlos aquí"}
      </button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {selected.length > 0 && (
        <div className="space-y-2" aria-label="Archivos seleccionados">
          {selected.map((attachment) => {
            const Icon = iconFor(attachment.file);
            return (
              <div key={attachment.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
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
                  <p className="truncate text-sm font-medium text-foreground">{attachment.file.name}</p>
                  <p className="text-xs text-foreground-muted">{attachment.file.type} · {formatBytes(attachment.file.size)}</p>
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
          <p className="text-xs text-foreground-muted">
            {selected.length} de {GMAIL_MAX_ATTACHMENT_COUNT} archivo(s) · {formatBytes(totalBytes)} en total
          </p>
        </div>
      )}
    </div>
  );
}
