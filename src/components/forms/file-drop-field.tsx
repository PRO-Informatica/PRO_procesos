"use client";

import { FileSpreadsheet, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState } from "react";

import { motionTokens } from "@/lib/motion/tokens";

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
  const [dragActive, setDragActive] = useState(false);

  const formattedSize = file
    ? file.size >= 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`
    : "";

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
      <AnimatePresence mode="wait" initial={false}>
      {file ? (
        <motion.div
          key="selected-file"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionTokens.duration.hover, ease: motionTokens.ease }}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-success/20 bg-success-soft/40 p-3 sm:p-4"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
            <FileSpreadsheet aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
            <p className="mt-0.5 text-xs text-foreground-muted">
              {formattedSize} · {file.type || "Archivo"}
            </p>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={disabled}
            className="icon-button shrink-0"
            aria-label="Quitar archivo"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </motion.div>
      ) : (
        <motion.label
          key="dropzone"
          htmlFor={id}
          onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragActive(true); }}
          onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragActive(true); }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setDragActive(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (!disabled) {
              choose(event.dataTransfer.files?.[0] ?? null, true);
            }
          }}
          initial={{ opacity: 0.88 }}
          animate={{ opacity: 1, scale: dragActive ? 1.006 : 1 }}
          whileHover={disabled ? undefined : { y: -1 }}
          transition={{ duration: motionTokens.duration.hover, ease: motionTokens.ease }}
          className={`group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center transition-colors duration-200 sm:min-h-44 sm:px-5 sm:py-8 ${dragActive ? "border-brand bg-brand-soft/55 shadow-[inset_0_0_0_1px_var(--brand)]" : "border-border bg-muted/20 hover:border-brand/45 hover:bg-brand-soft/30"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <motion.span animate={{ y: dragActive ? -2 : 0, scale: dragActive ? 1.06 : 1 }} transition={{ duration: motionTokens.duration.hover }}>
            <Upload aria-hidden="true" className="size-7 text-brand-strong transition-transform duration-200 group-hover:-translate-y-0.5" />
          </motion.span>
          <span className="mt-3 text-sm font-semibold text-foreground">
            <span className="sm:hidden">Selecciona el archivo</span>
            <span className="hidden sm:inline">Selecciona o arrastra el archivo</span>
          </span>
          <span className="mt-1 text-xs text-foreground-muted">
            Excel .xlsx · máximo {Math.round(maxBytes / 1024 / 1024)} MiB
          </span>
        </motion.label>
      )}
      </AnimatePresence>
      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
