"use client";

import { FileSpreadsheet, Upload, X } from "lucide-react";
import { useId, useRef, useState } from "react";

export function FileDropField({
  name,
  accept,
  maxBytes,
  disabled,
  onFileChange,
}: {
  name: string;
  accept: string;
  maxBytes: number;
  disabled?: boolean;
  onFileChange?: (file: File | null) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: File | null, syncInput = false) => {
    if (next && next.size > maxBytes) {
      setError(`El archivo supera el máximo de ${Math.round(maxBytes / 1024 / 1024)} MiB.`);
      return;
    }
    if (next && accept === ".xlsx" && !next.name.toLowerCase().endsWith(".xlsx")) {
      setError("Selecciona un archivo Excel .xlsx.");
      return;
    }
    if (syncInput && inputRef.current) {
      const transfer = new DataTransfer();
      if (next) transfer.items.add(next);
      inputRef.current.files = transfer.files;
    }
    setError(null);
    setFile(next);
    onFileChange?.(next);
  };

  const remove = () => {
    if (inputRef.current) inputRef.current.value = "";
    choose(null);
  };

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={!file}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => choose(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/25 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
            <FileSpreadsheet aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
            <p className="mt-0.5 text-xs text-foreground-muted">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={disabled}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Quitar archivo"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!disabled) {
              choose(event.dataTransfer.files?.[0] ?? null, true);
            }
          }}
          className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-5 py-8 text-center transition hover:border-brand/40 hover:bg-brand-soft/30"
        >
          <Upload aria-hidden="true" className="size-7 text-brand-strong" />
          <span className="mt-3 text-sm font-semibold text-foreground">
            Selecciona o arrastra el archivo
          </span>
          <span className="mt-1 text-xs text-foreground-muted">
            Excel .xlsx · máximo {Math.round(maxBytes / 1024 / 1024)} MiB
          </span>
        </label>
      )}
      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
