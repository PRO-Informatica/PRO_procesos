"use client";

import { Camera, FileUp, LoaderCircle } from "lucide-react";
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
const ALLOWED = new Set(ACCEPT.split(","));
const MAX_SIZE = 10 * 1024 * 1024;

export function DocumentUploader({
  projectId,
  contextId,
  context,
  label,
  existingDocumentId,
}: {
  projectId: string;
  contextId: string;
  context: "dispatch" | "guide" | "incident";
  label: string;
  existingDocumentId?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const uploadOne = async (file: File, documentId?: string) => {
    if (!ALLOWED.has(file.type)) throw new Error(`${file.name}: formato no permitido.`);
    if (file.size <= 0 || file.size > MAX_SIZE) throw new Error(`${file.name}: debe pesar menos de 10 MiB.`);
    const prepared = await prepareDispatchUpload({
      projectId,
      contextId,
      context,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      documentId,
    });
    if (prepared.status === "error") throw new Error(prepared.message);
    const target = prepared.upload;
    const uploaded = await createClient().storage.from(target.bucket).uploadToSignedUrl(
      target.path,
      target.token,
      file,
      { contentType: file.type, upsert: false },
    );
    if (uploaded.error) {
      await failDispatchUpload(projectId, target.documentId, target.versionId, uploaded.error.message);
      throw new Error(`${file.name}: no se pudo cargar.`);
    }
    const finalized = await finalizeDispatchUpload(projectId, target.documentId, target.versionId);
    if (finalized.status === "error") {
      await failDispatchUpload(projectId, target.documentId, target.versionId, finalized.message);
      throw new Error(finalized.message);
    }
  };

  const upload = async (files: FileList | null, fromCamera = false) => {
    if (!files?.length || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const selected = [...files];
      for (let index = 0; index < selected.length; index += 1) {
        setMessage(`Cargando ${index + 1} de ${selected.length}: ${selected[index].name}`);
        await uploadOne(selected[index], index === 0 ? existingDocumentId : undefined);
      }
      setMessage(`${selected.length} ${selected.length === 1 ? "archivo cargado" : "archivos cargados"} correctamente.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible cargar la evidencia.");
    } finally {
      setBusy(false);
      if (fromCamera && cameraInput.current) cameraInput.current.value = "";
      if (!fromCamera && fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(event) => void upload(event.target.files)} />
      <input ref={cameraInput} type="file" accept={IMAGE_ACCEPT} capture="environment" className="sr-only" onChange={(event) => void upload(event.target.files, true)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}{label}</button>
        <button type="button" disabled={busy} onClick={() => cameraInput.current?.click()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"><Camera className="size-4" /> Tomar foto</button>
      </div>
      {message && <p aria-live="polite" className={`text-xs ${message.includes("correctamente") ? "text-success" : "text-foreground-muted"}`}>{message}</p>}
    </div>
  );
}
