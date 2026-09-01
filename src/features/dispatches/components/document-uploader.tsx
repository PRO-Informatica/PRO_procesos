"use client";

import { Camera, FileUp, LoaderCircle, RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import {
  failDispatchUpload,
  finalizeDispatchUpload,
  prepareDispatchUpload,
} from "../actions";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED_TYPES = new Set(ACCEPT.split(","));
const MAX_SIZE = 10 * 1024 * 1024;

type UploadStage = "idle" | "preparing" | "uploading" | "validating" | "success" | "error";

const progressByStage: Record<UploadStage, number> = {
  idle: 0,
  preparing: 15,
  uploading: 60,
  validating: 90,
  success: 100,
  error: 0,
};

const stageLabels: Record<UploadStage, string> = {
  idle: "Listo para cargar",
  preparing: "Preparando carga segura…",
  uploading: "Subiendo archivo…",
  validating: "Validando documento…",
  success: "Documento cargado correctamente",
  error: "La carga necesita atención",
};

function readableType(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "image/jpeg") return "Imagen JPEG";
  if (mimeType === "image/png") return "Imagen PNG";
  if (mimeType === "image/webp") return "Imagen WebP";
  return "Archivo";
}

export function DocumentUploader({
  projectId,
  contextId,
  context,
  label,
  existingDocumentId,
}: {
  projectId: string;
  contextId: string;
  context: "guide" | "incident";
  label: string;
  existingDocumentId?: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [message, setMessage] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [fileType, setFileType] = useState<string>();
  const [retryDocumentId, setRetryDocumentId] = useState(existingDocumentId);
  const busy = stage === "preparing" || stage === "uploading" || stage === "validating";

  const upload = async (file?: File) => {
    if (!file || busy) return;
    setFileName(file.name);
    setFileType(file.type);
    setMessage(undefined);

    if (!ALLOWED_TYPES.has(file.type)) {
      setStage("error");
      setMessage("Selecciona una foto JPEG, PNG, WebP o un archivo PDF.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_SIZE) {
      setStage("error");
      setMessage("El archivo debe tener contenido y no superar 10 MiB.");
      return;
    }

    setStage("preparing");
    const prepared = await prepareDispatchUpload({
      projectId,
      contextId,
      context,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      documentId: retryDocumentId,
    });
    if (prepared.status === "error") {
      setStage("error");
      setMessage(prepared.message);
      return;
    }

    const { upload: target } = prepared;
    setRetryDocumentId(target.documentId);
    setStage("uploading");
    const result = await createClient()
      .storage
      .from(target.bucket)
      .uploadToSignedUrl(target.path, target.token, file, {
        contentType: file.type,
        upsert: false,
      });
    if (result.error) {
      await failDispatchUpload(
        projectId,
        target.documentId,
        target.versionId,
        `Carga de navegador fallida: ${result.error.message}`,
      );
      setStage("error");
      setMessage("El despacho fue registrado, pero el documento no pudo cargarse. Puedes reintentar.");
      return;
    }

    setStage("validating");
    const finalized = await finalizeDispatchUpload(
      projectId,
      target.documentId,
      target.versionId,
    );
    if (finalized.status === "error") {
      await failDispatchUpload(
        projectId,
        target.documentId,
        target.versionId,
        "La validación final del archivo falló.",
      );
      setStage("error");
      setMessage(`${finalized.message} El despacho y la guía permanecen registrados.`);
      return;
    }

    setRetryDocumentId(undefined);
    setStage("success");
    setMessage(
      context === "guide"
        ? "La guía física quedó vinculada al expediente privado."
        : "La evidencia quedó vinculada a la incidencia."
    );
    router.refresh();
  };

  const chooseFile = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = "";
    input.click();
  };

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
      <input ref={cameraInputRef} type="file" accept={IMAGE_ACCEPT} capture="environment" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" disabled={busy} onClick={() => chooseFile(fileInputRef.current)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">
          {busy ? <LoaderCircle className={`size-4 ${reduceMotion ? "" : "animate-spin"}`} /> : stage === "error" ? <RotateCcw className="size-4" /> : <FileUp className="size-4" />}
          {stage === "error" ? "Reintentar carga" : label}
        </button>
        <button type="button" disabled={busy} onClick={() => chooseFile(cameraInputRef.current)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">
          <Camera className="size-4" /> Tomar foto
        </button>
      </div>
      {(fileName || stage !== "idle") && (
        <div className="rounded-lg bg-muted/45 p-3" aria-live="polite">
          {fileName && <p className="break-all text-xs font-semibold text-foreground">{fileName}</p>}
          {fileType && <p className="mt-1 text-[11px] text-foreground-muted">{readableType(fileType)}</p>}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Progreso de carga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressByStage[stage]}>
            <div className={`h-full rounded-full ${stage === "error" ? "bg-destructive" : "bg-brand"} ${reduceMotion ? "" : "transition-[width] duration-300"}`} style={{ width: `${progressByStage[stage]}%` }} />
          </div>
          <p className={`mt-2 text-xs ${stage === "error" ? "text-destructive" : stage === "success" ? "text-success" : "text-foreground-muted"}`}>{message ?? stageLabels[stage]}</p>
        </div>
      )}
    </div>
  );
}
