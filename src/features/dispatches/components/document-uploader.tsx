"use client";

import { Camera, CheckCircle2, FileUp, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { notifications } from "@/lib/notification-messages";
import { notify } from "@/lib/notify";
import { createClient } from "@/lib/supabase/client";

import { failDispatchUpload, finalizeDispatchUpload, prepareDispatchUpload } from "../actions";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED = new Set(ACCEPT.split(","));
const MAX_SIZE = 10 * 1024 * 1024;

type UploadItem = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  replacementDocumentId?: string;
};

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentUploader({ projectId, contextId, context, label, existingDocumentId }: {
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
  const [items, setItems] = useState<UploadItem[]>([]);

  const updateItem = (id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const uploadOne = async (item: UploadItem) => {
    const { file } = item;
    if (!ALLOWED.has(file.type)) throw new Error("Formato no permitido.");
    if (file.size <= 0 || file.size > MAX_SIZE) throw new Error("El archivo debe pesar menos de 10 MB.");
    const prepared = await prepareDispatchUpload({
      projectId, contextId, context, fileName: file.name,
      mimeType: file.type, fileSize: file.size,
      documentId: item.replacementDocumentId,
    });
    if (prepared.status === "error") throw new Error("No se pudo preparar la carga.");
    const target = prepared.upload;
    const uploaded = await createClient().storage.from(target.bucket).uploadToSignedUrl(
      target.path, target.token, file, { contentType: file.type, upsert: false },
    );
    if (uploaded.error) {
      await failDispatchUpload(projectId, target.documentId, target.versionId, uploaded.error.message);
      throw new Error("No se pudo cargar el archivo.");
    }
    const finalized = await finalizeDispatchUpload(projectId, target.documentId, target.versionId);
    if (finalized.status === "error") {
      await failDispatchUpload(projectId, target.documentId, target.versionId, finalized.message);
      throw new Error("No se pudo guardar el archivo.");
    }
  };

  const processItems = async (selected: UploadItem[]) => {
    if (!selected.length || busy) return;
    setBusy(true);
    let completed = 0;
    for (const item of selected) {
      updateItem(item.id, { status: "uploading", error: undefined });
      try {
        await uploadOne(item);
        completed += 1;
        updateItem(item.id, { status: "success" });
      } catch (error) {
        updateItem(item.id, { status: "error", error: error instanceof Error ? error.message : "No se pudo cargar el archivo." });
      }
    }
    setBusy(false);
    if (completed) {
      notify.success(completed === 1 ? notifications.documentUploaded : notifications.documentsUploaded);
      router.refresh();
    }
    if (completed < selected.length) notify.error(notifications.uploadFailed);
  };

  const selectFiles = (files: FileList | null, fromCamera = false) => {
    if (!files?.length || busy) return;
    const selected = [...files].map<UploadItem>((file, index) => ({
      id: crypto.randomUUID(), file, status: "pending",
      replacementDocumentId: index === 0 ? existingDocumentId : undefined,
    }));
    setItems((current) => [...current, ...selected]);
    void processItems(selected);
    if (fromCamera && cameraInput.current) cameraInput.current.value = "";
    if (!fromCamera && fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="space-y-3">
      <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(event) => selectFiles(event.target.files)} />
      <input ref={cameraInput} type="file" accept={IMAGE_ACCEPT} capture="environment" className="sr-only" onChange={(event) => selectFiles(event.target.files, true)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()} className="min-h-10 px-3 text-xs">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}{label}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => cameraInput.current?.click()} className="min-h-10 px-3 text-xs"><Camera className="size-4" /> Tomar foto</Button>
      </div>
      {items.length > 0 && <ul className="space-y-2" aria-live="polite">
        {items.map((item) => <li key={item.id} className="overflow-hidden rounded-lg border border-border bg-muted/15">
          <div className="flex items-center gap-3 px-3 py-2.5">
            {item.status === "uploading" ? <LoaderCircle className="size-4 shrink-0 animate-spin text-brand-strong" /> : item.status === "success" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <FileUp className="size-4 shrink-0 text-foreground-muted" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold" title={item.file.name}>{item.file.name}</p>
              <p className={`mt-0.5 text-[11px] ${item.status === "error" ? "text-destructive" : "text-foreground-muted"}`}>
                {item.error ?? (item.status === "uploading" ? "Cargando…" : item.status === "success" ? "Cargado" : `Pendiente · ${fileSize(item.file.size)}`)}
              </p>
            </div>
            {item.status === "error" && <IconButton label={`Reintentar ${item.file.name}`} onClick={() => void processItems([item])} disabled={busy}><RotateCcw className="size-4" /></IconButton>}
            {(item.status === "pending" || item.status === "error") && <IconButton label={`Quitar ${item.file.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} disabled={busy} tone="destructive"><Trash2 className="size-4" /></IconButton>}
          </div>
          {item.status === "uploading" && <div className="h-0.5 overflow-hidden bg-muted"><div className="h-full w-1/2 animate-pulse bg-brand motion-reduce:w-full motion-reduce:animate-none" /></div>}
        </li>)}
      </ul>}
    </div>
  );
}
