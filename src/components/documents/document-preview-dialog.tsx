"use client";

import { Download, Eye, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

type SignedDocumentResult =
  | { status: "success"; url: string }
  | { status: "error"; message: string };

type SignedDocumentAction = (
  projectId: string,
  documentId: string,
) => Promise<SignedDocumentResult>;

type DocumentActionsProps = {
  projectId: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  getSignedUrl: SignedDocumentAction;
  compact?: boolean;
};

function isPdf(mimeType: string, fileName: string) {
  return mimeType.toLowerCase() === "application/pdf" || /\.pdf$/iu.test(fileName);
}

function isImage(mimeType: string, fileName: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType.toLowerCase())
    || /\.(jpe?g|png|webp)$/iu.test(fileName);
}

export function DocumentActions({
  projectId,
  documentId,
  fileName,
  mimeType,
  getSignedUrl,
  compact = false,
}: DocumentActionsProps) {
  const [open, setOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();

  const download = async () => {
    setDownloadBusy(true);
    setDownloadError(undefined);
    const result = await getSignedUrl(projectId, documentId);
    setDownloadBusy(false);
    if (result.status === "success") {
      window.open(result.url, "_blank", "noopener,noreferrer");
      return;
    }
    setDownloadError("No fue posible preparar la descarga privada.");
  };

  const buttonClass = compact
    ? "inline-flex size-10 items-center justify-center rounded-lg border border-border text-foreground-muted hover:bg-muted hover:text-foreground disabled:opacity-50"
    : "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50";

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={buttonClass} onClick={() => setOpen(true)} aria-label={`Ver ${fileName}`}>
          <Eye className="size-4" />
          {!compact && "Ver"}
        </button>
        <button type="button" className={buttonClass} onClick={() => void download()} disabled={downloadBusy} aria-label={`Descargar ${fileName}`}>
          {downloadBusy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Download className="size-4" />}
          {!compact && "Descargar"}
        </button>
        {downloadError && <p className="basis-full text-right text-xs text-destructive">{downloadError}</p>}
      </div>
      {open && (
        <DocumentPreviewDialog
          projectId={projectId}
          documentId={documentId}
          fileName={fileName}
          mimeType={mimeType}
          getSignedUrl={getSignedUrl}
          onClose={() => setOpen(false)}
          onDownload={() => void download()}
          downloadBusy={downloadBusy}
        />
      )}
    </>
  );
}

function DocumentPreviewDialog({
  projectId,
  documentId,
  fileName,
  mimeType,
  getSignedUrl,
  onClose,
  onDownload,
  downloadBusy,
}: Omit<DocumentActionsProps, "compact"> & {
  onClose: () => void;
  onDownload: () => void;
  downloadBusy: boolean;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void getSignedUrl(projectId, documentId).then((result) => {
      if (!active) return;
      if (result.status === "success") setUrl(result.url);
      else setError("No fue posible cargar la vista previa del documento.");
    });
    return () => { active = false; };
  }, [documentId, getSignedUrl, projectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-0 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex h-dvh w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-[min(92vh,56rem)] sm:w-[min(96vw,80rem)] sm:rounded-2xl sm:border sm:border-border">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p id="document-preview-title" className="truncate text-sm font-semibold text-foreground">{fileName}</p>
            <p className="text-xs text-foreground-muted">Vista previa privada</p>
          </div>
          <button type="button" onClick={onDownload} disabled={downloadBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">
            {downloadBusy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Download className="size-4" />}
            <span className="hidden sm:inline">Descargar</span>
          </button>
          <button type="button" onClick={onClose} className="inline-grid size-10 place-items-center rounded-lg border border-border text-foreground-muted hover:bg-muted hover:text-foreground" aria-label="Cerrar vista previa">
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-2 sm:p-4">
          {!url && !error && (
            <div className="grid h-full place-items-center text-sm text-foreground-muted" aria-live="polite">
              <span className="inline-flex items-center gap-2"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> Cargando vista previa…</span>
            </div>
          )}
          {error && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div><p className="font-semibold text-foreground">{error}</p><p className="mt-2 text-sm text-foreground-muted">Puedes intentar descargarlo o cerrar esta ventana.</p></div>
            </div>
          )}
          {url && isPdf(mimeType, fileName) && <iframe src={url} title={`Vista previa de ${fileName}`} className="h-full min-h-[70vh] w-full rounded-lg border-0 bg-white" />}
          {url && isImage(mimeType, fileName) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`Vista previa de ${fileName}`} className="mx-auto max-h-full max-w-full rounded-lg object-contain" />
          )}
          {url && !isPdf(mimeType, fileName) && !isImage(mimeType, fileName) && (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-foreground-muted">Este formato no admite vista previa. Usa Descargar para abrir el archivo.</div>
          )}
        </div>
      </section>
    </div>
  );
}
