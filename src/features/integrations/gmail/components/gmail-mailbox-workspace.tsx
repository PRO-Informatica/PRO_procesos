"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  Inbox,
  MailPlus,
  Paperclip,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GoogleLogo } from "@/components/brand/google-logo";
import { FilePreviewDialog } from "@/components/documents/document-preview-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/class-names";

import type {
  GmailAttachmentSummary,
  GmailMailboxFolder,
  GmailMailboxPage,
  GmailThreadDetail,
  GmailThreadSummary,
} from "../mailbox-types";
import {
  GmailAttachmentPicker,
  type SelectedGmailAttachment,
} from "./gmail-attachment-picker";

type ApiError = { code?: string; message?: string };

function appendAttachments(formData: FormData, attachments: SelectedGmailAttachment[]) {
  for (const attachment of attachments) {
    formData.append("attachments", attachment.file, attachment.file.name);
  }
}

function attachmentUrl(
  projectId: string,
  messageId: string,
  attachmentId: string,
  disposition: "attachment" | "inline",
) {
  const query = new URLSearchParams({ projectId });
  if (disposition === "inline") query.set("disposition", "inline");
  return `/api/integrations/gmail/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}?${query}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentPresentation(mimeType: string, fileName: string) {
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toUpperCase() : undefined;
  if (mimeType.startsWith("image/")) return { Icon: FileImage, label: extension ?? "Imagen" };
  if (/spreadsheet|excel|csv/iu.test(mimeType)) return { Icon: FileSpreadsheet, label: extension ?? "Hoja de cálculo" };
  return { Icon: FileText, label: extension ?? "Documento" };
}

function MessageAttachments({
  attachments,
  direction,
  messageId,
  projectId,
}: {
  attachments: GmailAttachmentSummary[];
  direction: "RECEIVED" | "SENT";
  messageId: string;
  projectId: string;
}) {
  const [preview, setPreview] = useState<GmailAttachmentSummary | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <section className="mt-4" aria-label={direction === "RECEIVED" ? "Adjuntos recibidos" : "Adjuntos enviados"}>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
          {direction === "RECEIVED" ? "Adjuntos recibidos" : "Adjuntos enviados"}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {attachments.map((attachment) => {
            const { Icon, label } = attachmentPresentation(attachment.mimeType, attachment.fileName);
            return (
              <article key={attachment.id} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-foreground-muted shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground" title={attachment.fileName}>{attachment.fileName}</p>
                  <p className="mt-0.5 text-[11px] text-foreground-muted">{label} · {formatBytes(attachment.size)}</p>
                </div>
                <div className="flex shrink-0 items-center">
                  {attachment.previewable && (
                    <button
                      type="button"
                      onClick={() => setPreview(attachment)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-foreground-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none"
                      aria-label={`Ver ${attachment.fileName}`}
                      title="Ver"
                    >
                      <Eye aria-hidden="true" className="size-4" />
                      <span>Ver</span>
                    </button>
                  )}
                  <a
                    href={attachmentUrl(projectId, messageId, attachment.id, "attachment")}
                    className="grid size-9 place-items-center rounded-lg text-foreground-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none"
                    aria-label={`Descargar ${attachment.fileName}`}
                    title="Descargar"
                  >
                    <Download aria-hidden="true" className="size-4" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {preview && (
        <FilePreviewDialog
          fileName={preview.fileName}
          mimeType={preview.mimeType}
          url={attachmentUrl(projectId, messageId, preview.id, "inline")}
          downloadUrl={attachmentUrl(projectId, messageId, preview.id, "attachment")}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function formatMailboxDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat("es-GT", { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "short" }).format(date);
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorPresentation(error: ApiError | null) {
  if (!error) return null;
  if (error.code === "GMAIL_REAUTH_REQUIRED") {
    return {
      title: "Gmail requiere reconexión",
      message: "Reconecta tu cuenta corporativa para continuar.",
      action: true,
    };
  }
  if (error.code === "SENDERS_NOT_CONFIGURED") {
    return { title: "Remitentes sin configurar", message: error.message ?? "La recepción de correos está bloqueada.", action: false };
  }
  if (error.code === "RECIPIENTS_NOT_CONFIGURED") {
    return { title: "Destinatarios sin configurar", message: error.message ?? "El envío de correos está bloqueado.", action: false };
  }
  if (error.code === "GMAIL_RATE_LIMITED") {
    return { title: "Límite temporal de Gmail", message: "Espera un momento antes de actualizar nuevamente.", action: false };
  }
  if (error.code === "NETWORK_OFFLINE") {
    return { title: "Sin conexión de red", message: "Verifica tu conexión e intenta actualizar nuevamente.", action: false };
  }
  return { title: "No fue posible actualizar los correos", message: error.message ?? "Intenta nuevamente.", action: false };
}

function MailboxSkeleton() {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="space-y-2.5 px-4 py-4">
          <div className="flex justify-between gap-4">
            <div className="skeleton-pulse h-3 w-2/5 rounded bg-border/70" />
            <div className="skeleton-pulse h-3 w-14 rounded bg-border/70" />
          </div>
          <div className="skeleton-pulse h-4 w-4/5 rounded bg-border/70" />
          <div className="skeleton-pulse h-3 w-full rounded bg-border/70" />
        </div>
      ))}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status">
      <span className="sr-only">Cargando conversación…</span>
      <div className="space-y-3 border-b border-border pb-5">
        <div className="skeleton-pulse h-5 w-3/5 rounded bg-border/70" />
        <div className="skeleton-pulse h-3 w-2/5 rounded bg-border/70" />
      </div>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="space-y-3 border-b border-border pb-5">
          <div className="skeleton-pulse h-3 w-1/3 rounded bg-border/70" />
          <div className="skeleton-pulse h-3 w-full rounded bg-border/70" />
          <div className="skeleton-pulse h-3 w-5/6 rounded bg-border/70" />
        </div>
      ))}
    </div>
  );
}

function ComposeDialog({
  attachmentMaxBytes,
  recipients,
  from,
  onClose,
  onSent,
  projectId,
}: {
  attachmentMaxBytes: number;
  recipients: string[];
  from: string;
  onClose: () => void;
  onSent: () => void;
  projectId: string;
}) {
  const [recipient, setRecipient] = useState(recipients[0] ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SelectedGmailAttachment[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const dirty = Boolean(subject || body || attachments.length || recipient !== (recipients[0] ?? ""));
  const draftChanged = () => { idempotencyKeyRef.current = null; };
  const close = () => {
    if (dirty && !window.confirm("¿Cerrar el correo sin enviarlo?")) return;
    onClose();
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setMessage(null);
    try {
      const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
      idempotencyKeyRef.current = idempotencyKey;
      const formData = new FormData();
      formData.set("recipient", recipient);
      formData.set("subject", subject);
      formData.set("body", body);
      formData.set("idempotencyKey", idempotencyKey);
      appendAttachments(formData, attachments);
      const response = await fetch(`/api/integrations/gmail/send?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        body: formData,
      });
      const result: ApiError = await response.json();
      if (!response.ok) {
        if (result.code !== "SEND_RESULT_UNKNOWN") idempotencyKeyRef.current = null;
        throw new Error(result.message ?? "No fue posible enviar el correo.");
      }
      onSent();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible enviar el correo.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Nuevo mensaje"
      description="Redacta un correo en texto plano desde tu cuenta conectada."
      icon={MailPlus}
      onClose={close}
      pending={pending}
      size="xl"
    >
      <form onSubmit={submit} className="flex min-h-[min(42rem,calc(100dvh-8rem))] flex-col sm:min-h-[36rem]">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div aria-live="polite" aria-atomic="true">
            {message && <p className="mb-4 rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-sm text-destructive">{message}</p>}
          </div>
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            <label className="grid gap-1 px-3 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center sm:px-4">
              <span className="text-xs font-semibold text-foreground-muted">De</span>
              <input value={from} readOnly className="min-w-0 border-0 bg-transparent p-0 text-sm text-foreground-muted outline-none" />
            </label>
            <label className="grid gap-1 px-3 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center sm:px-4">
              <span className="text-xs font-semibold text-foreground-muted">Para</span>
              <select
                value={recipient}
                onChange={(event) => { setRecipient(event.target.value); draftChanged(); }}
                required
                data-dialog-initial-focus
                className="min-h-9 min-w-0 rounded-lg border-0 bg-muted px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-brand"
              >
                {recipients.map((email) => <option key={email} value={email}>{email}</option>)}
              </select>
            </label>
            <label className="grid gap-1 px-3 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center sm:px-4">
              <span className="text-xs font-semibold text-foreground-muted">Asunto</span>
              <input
                value={subject}
                onChange={(event) => { setSubject(event.target.value); draftChanged(); }}
                maxLength={200}
                required
                placeholder="Escribe el asunto"
                className="min-h-9 min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-foreground-muted/70"
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="sr-only">Mensaje</span>
            <textarea
              value={body}
              onChange={(event) => { setBody(event.target.value); draftChanged(); }}
              maxLength={50_000}
              required
              rows={11}
              placeholder="Escribe tu mensaje…"
              className="min-h-56 w-full resize-y rounded-xl border border-border bg-surface p-4 text-sm leading-7 text-foreground outline-none transition-shadow placeholder:text-foreground-muted/70 focus:ring-2 focus:ring-brand motion-reduce:transition-none"
            />
          </label>
          <div className="mt-4">
            <GmailAttachmentPicker
              selected={attachments}
              onChange={(files) => { setAttachments(files); draftChanged(); }}
              maxBytes={attachmentMaxBytes}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={pending}>Descartar</Button>
          <Button type="submit" disabled={pending || !recipient || !subject.trim() || !body.trim()} className="gap-2" aria-describedby="compose-status">
            <Send aria-hidden="true" className="size-4" />
            {pending ? "Enviando…" : "Enviar"}
          </Button>
          <span id="compose-status" className="sr-only" aria-live="polite">{pending ? "Enviando correo" : ""}</span>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function replyRecipient(detail: GmailThreadDetail) {
  const last = detail.messages.at(-1);
  if (!last) return "destinatario permitido";
  return last.direction === "RECEIVED" ? last.from : (last.to[0] ?? "destinatario permitido");
}

function ThreadReader({
  attachmentMaxBytes,
  detail,
  error,
  loading,
  projectId,
  onBack,
  onRetry,
  onReplySent,
}: {
  attachmentMaxBytes: number;
  detail: GmailThreadDetail | null;
  error: ApiError | null;
  loading: boolean;
  projectId: string;
  onBack: () => void;
  onRetry: () => void;
  onReplySent: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SelectedGmailAttachment[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const replyFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!replying) return;
    const frame = window.requestAnimationFrame(() => {
      replyFormRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [replying]);

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setMessage(null);
    try {
      const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
      idempotencyKeyRef.current = idempotencyKey;
      const formData = new FormData();
      formData.set("threadId", detail.id);
      formData.set("body", body);
      formData.set("idempotencyKey", idempotencyKey);
      appendAttachments(formData, attachments);
      const response = await fetch(`/api/integrations/gmail/reply?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        body: formData,
      });
      const result: ApiError = await response.json();
      if (!response.ok) {
        if (result.code !== "SEND_RESULT_UNKNOWN") idempotencyKeyRef.current = null;
        throw new Error(result.message ?? "No fue posible responder.");
      }
      setBody("");
      setAttachments([]);
      idempotencyKeyRef.current = null;
      setReplying(false);
      onReplySent();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "No fue posible responder.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  if (loading) return <ThreadSkeleton />;

  if (error) {
    return (
      <div className="grid h-full min-h-[24rem] place-items-center p-6 text-center" role="alert">
        <div className="max-w-sm">
          <Inbox aria-hidden="true" className="mx-auto size-8 text-destructive/70" />
          <p className="mt-3 font-semibold text-foreground">No fue posible abrir la conversación</p>
          <p className="mt-1 text-sm leading-6 text-foreground-muted">{error.message ?? "Intenta nuevamente."}</p>
          <Button variant="secondary" onClick={onRetry} className="mt-4 gap-2"><RefreshCw aria-hidden="true" className="size-4" />Reintentar</Button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="grid h-full min-h-[24rem] place-items-center p-6 text-center">
        <div className="max-w-xs">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-foreground-muted">
            <Inbox aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 font-semibold text-foreground">Selecciona una conversación</p>
          <p className="mt-1 text-sm leading-6 text-foreground-muted">El contenido del hilo aparecerá aquí.</p>
        </div>
      </div>
    );
  }

  const hiddenMessages = Math.max(0, detail.messages.length - 2);
  const visibleMessages = showEarlier ? detail.messages : detail.messages.slice(hiddenMessages);
  const recipient = replyRecipient(detail);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-border bg-surface px-3 py-3 sm:px-5 sm:py-4">
        <button type="button" onClick={onBack} className="grid size-10 shrink-0 place-items-center rounded-lg text-foreground-muted transition-colors hover:bg-muted hover:text-foreground md:hidden motion-reduce:transition-none" aria-label="Volver a conversaciones">
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold text-foreground sm:text-lg">{detail.subject}</h2>
          <p className="mt-1 text-xs text-foreground-muted">{detail.messages.length} {detail.messages.length === 1 ? "mensaje" : "mensajes"} en esta conversación</p>
        </div>
        {detail.replyAvailable && (
          <Button variant="secondary" onClick={() => setReplying(true)} className="shrink-0 gap-2 px-3">
            <Reply aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">Responder</span>
          </Button>
        )}
      </header>

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain" data-mail-scroll="thread">
        <div className="mx-auto max-w-4xl px-3 py-2 sm:px-5 sm:py-4">
          {hiddenMessages > 0 && !showEarlier && (
            <button
              type="button"
              onClick={() => setShowEarlier(true)}
              className="mb-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-foreground-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
              Mostrar {hiddenMessages} {hiddenMessages === 1 ? "mensaje anterior" : "mensajes anteriores"}
            </button>
          )}

          <div className="space-y-3">
            {visibleMessages.map((item) => {
              const received = item.direction === "RECEIVED";
              const isReply = Boolean(item.referencesHeader) || /^re:/iu.test(item.subject);
              const directionLabel = received
                ? "Mensaje recibido"
                : isReply ? "Respuesta enviada" : "Mensaje enviado";

              return (
                <article
                  key={item.id}
                  className={cn(
                    "rounded-xl border-l-2 px-3 py-4 sm:px-4",
                    received
                      ? "border-border bg-muted/30"
                      : "border-brand/65 bg-brand-soft/30",
                  )}
                >
                  <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <span className={cn(
                        "mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        received
                          ? "bg-surface text-foreground-muted"
                          : "bg-brand-soft text-brand-strong",
                      )}>
                        {received
                          ? <Inbox aria-hidden="true" className="size-3.5" />
                          : <Reply aria-hidden="true" className="size-3.5" />}
                        {directionLabel}
                        {received && item.isUnread && <span>· No leído</span>}
                      </span>
                      <p className="break-all text-sm font-semibold text-foreground">
                        {received ? item.from : `Para: ${item.to.join(", ")}`}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground-muted">
                        {received ? `Para: ${item.to.join(", ")}` : "Enviado desde tu cuenta conectada"}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-foreground-muted" dateTime={item.sentAt}>{formatMessageDate(item.sentAt)}</time>
                  </header>
                  <p className="whitespace-pre-wrap break-words pt-4 text-sm leading-7 text-foreground">{item.body || "Este mensaje no contiene texto visible."}</p>
                  <MessageAttachments attachments={item.attachments} direction={item.direction} messageId={item.id} projectId={projectId} />
                </article>
              );
            })}
          </div>

          {detail.replyAvailable && (
            <form ref={replyFormRef} onSubmit={submitReply} className={cn(
              "my-4 rounded-xl border transition-[border-color,background-color,box-shadow] motion-reduce:transition-none",
              replying ? "border-brand/30 bg-surface shadow-[0_8px_24px_rgba(16,24,40,0.07)]" : "border-border bg-muted/35",
            )}>
              {!replying ? (
                <button
                  type="button"
                  onClick={() => setReplying(true)}
                  onFocus={() => setReplying(true)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 text-left text-sm text-foreground-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Reply aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">Responder a {recipient}</span>
                </button>
              ) : (
                <div className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-xs text-foreground-muted">Responder a <span className="font-semibold text-foreground">{recipient}</span></p>
                    <IconButton
                      label="Cerrar respuesta"
                      onClick={() => {
                        if ((!body && attachments.length === 0) || window.confirm("¿Descartar la respuesta?")) {
                          setReplying(false);
                          setBody("");
                          setAttachments([]);
                          setMessage(null);
                          idempotencyKeyRef.current = null;
                        }
                      }}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </IconButton>
                  </div>
                  <div aria-live="polite" aria-atomic="true">
                    {message && <p className="mt-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">{message}</p>}
                  </div>
                  <textarea
                    autoFocus
                    value={body}
                    onChange={(event) => { setBody(event.target.value); idempotencyKeyRef.current = null; }}
                    required
                    maxLength={50_000}
                    rows={5}
                    className="mt-2 min-h-32 w-full resize-y border-0 bg-transparent p-1 text-sm leading-7 text-foreground outline-none placeholder:text-foreground-muted/70"
                    aria-label="Mensaje de respuesta"
                    placeholder="Escribe una respuesta…"
                  />
                  <GmailAttachmentPicker
                    selected={attachments}
                    onChange={(files) => { setAttachments(files); idempotencyKeyRef.current = null; }}
                    maxBytes={attachmentMaxBytes}
                    disabled={pending}
                  />
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <span className="sr-only" aria-live="polite">{pending ? "Enviando respuesta" : ""}</span>
                    <Button type="submit" disabled={pending || !body.trim()} className="gap-2">
                      <Send aria-hidden="true" className="size-4" />
                      {pending ? "Enviando…" : "Enviar respuesta"}
                    </Button>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const ConversationList = memo(function ConversationList({
  folder,
  loading,
  nextPageToken,
  onLoadMore,
  onRefresh,
  onSelect,
  query,
  selectedId,
  setQuery,
  threads,
}: {
  folder: GmailMailboxFolder;
  loading: boolean;
  nextPageToken: string | null;
  onLoadMore: () => void;
  onRefresh: () => void;
  onSelect: (threadId: string) => void;
  query: string;
  selectedId: string | null;
  setQuery: (value: string) => void;
  threads: GmailThreadSummary[];
}) {
  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-GT");
    if (!normalized) return threads;
    return threads.filter((thread) => [thread.counterpart, thread.subject, thread.snippet]
      .some((value) => value.toLocaleLowerCase("es-GT").includes(normalized)));
  }, [query, threads]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{folder === "INBOX" ? "Recibidos" : "Enviados"}</h2>
            <p className="mt-0.5 text-xs text-foreground-muted">Conversaciones autorizadas</p>
          </div>
          <IconButton label="Actualizar bandeja" tooltipSide="bottom" onClick={onRefresh} disabled={loading}>
            <RefreshCw aria-hidden="true" className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} />
          </IconButton>
        </div>
        <label className="relative mt-3 block">
          <span className="sr-only">Buscar en las conversaciones cargadas</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en esta página"
            className="h-10 w-full rounded-lg border border-border bg-muted/50 pl-9 pr-9 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-foreground-muted/70 focus:border-brand/40 focus:bg-surface focus:ring-2 focus:ring-brand/20 motion-reduce:transition-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-foreground-muted hover:bg-surface hover:text-foreground" aria-label="Limpiar búsqueda">
              <X aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </label>
      </header>

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain" data-mail-scroll="list">
        {loading && threads.length === 0 ? <MailboxSkeleton /> : threads.length === 0 ? (
          <div className="grid min-h-[22rem] place-items-center p-6 text-center">
            <div className="max-w-xs">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-muted text-foreground-muted"><Inbox aria-hidden="true" className="size-5" /></span>
              <p className="mt-4 font-semibold text-foreground">{folder === "INBOX" ? "Sin correos recibidos permitidos" : "Sin correos enviados"}</p>
              <p className="mt-1 text-sm leading-6 text-foreground-muted">Actualiza la bandeja para consultar nuevamente.</p>
            </div>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="grid min-h-[18rem] place-items-center p-6 text-center">
            <div><Search aria-hidden="true" className="mx-auto size-6 text-foreground-muted" /><p className="mt-3 font-semibold text-foreground">Sin coincidencias</p><p className="mt-1 text-sm text-foreground-muted">Prueba con otro remitente o asunto.</p></div>
          </div>
        ) : (
          <div role="list" aria-label="Conversaciones">
            {filteredThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                role="listitem"
                onClick={() => onSelect(thread.id)}
                aria-current={selectedId === thread.id ? "true" : undefined}
                className={cn(
                  "group relative w-full border-b border-border px-4 py-3.5 text-left transition-colors hover:bg-muted/70 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand motion-reduce:transition-none",
                  selectedId === thread.id && "bg-brand-soft/60 after:absolute after:inset-y-2 after:left-0 after:w-0.5 after:rounded-full after:bg-brand",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {thread.isUnread && (
                      <span
                        className="size-2 shrink-0 rounded-full bg-brand"
                        aria-label="No leído"
                        title="No leído"
                      />
                    )}
                    <p className={cn(
                      "truncate text-sm text-foreground",
                      thread.isUnread ? "font-bold" : "font-semibold",
                    )}>{thread.counterpart}</p>
                  </div>
                  <time className="shrink-0 text-[11px] text-foreground-muted" dateTime={thread.sentAt}>{formatMailboxDate(thread.sentAt)}</time>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <p className={cn(
                    "truncate text-sm text-foreground",
                    thread.isUnread ? "font-bold" : "font-medium",
                  )}>{thread.subject}</p>
                  {thread.messageCount > 1 && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted" aria-label={`${thread.messageCount} mensajes`}>{thread.messageCount}</span>}
                  {thread.hasAttachments && <Paperclip aria-label="Contiene adjuntos" className="size-3.5 shrink-0 text-foreground-muted" />}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground-muted">{thread.snippet}</p>
              </button>
            ))}
            {nextPageToken && !query && (
              <div className="p-3">
                <Button variant="secondary" onClick={onLoadMore} disabled={loading} className="w-full gap-2">
                  {loading ? "Cargando…" : "Cargar más"}<ChevronDown aria-hidden="true" className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function FolderButtons({
  folder,
  onChange,
  compact = false,
}: {
  folder: GmailMailboxFolder;
  onChange: (folder: GmailMailboxFolder) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-1", compact ? "grid-cols-2" : "grid-cols-1")} role="tablist" aria-label="Carpetas de correo">
      {(["INBOX", "SENT"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={folder === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none",
            compact && "justify-center",
            folder === value ? "bg-brand-soft text-brand-strong" : "text-foreground-muted hover:bg-muted hover:text-foreground",
          )}
        >
          {value === "INBOX" ? <Inbox aria-hidden="true" className="size-4" /> : <Send aria-hidden="true" className="size-4" />}
          {value === "INBOX" ? "Recibidos" : "Enviados"}
        </button>
      ))}
    </div>
  );
}

function MailNavigation({
  canSend,
  connectedEmail,
  folder,
  loading,
  onCompose,
  onFolderChange,
  onRefresh,
}: {
  canSend: boolean;
  connectedEmail: string;
  folder: GmailMailboxFolder;
  loading: boolean;
  onCompose: () => void;
  onFolderChange: (folder: GmailMailboxFolder) => void;
  onRefresh: () => void;
}) {
  return (
    <nav className="hidden min-h-0 flex-col border-r border-border bg-muted/25 p-3 xl:flex" aria-label="Navegación de correo">
      <div className="px-1 pb-4 pt-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">Comunicación</p>
        <p className="mt-1 text-xl font-bold tracking-tight text-foreground">Correo</p>
      </div>
      {canSend && <Button onClick={onCompose} className="w-full gap-2"><MailPlus aria-hidden="true" className="size-4" />Redactar</Button>}
      <div className="mt-4"><FolderButtons folder={folder} onChange={onFolderChange} /></div>
      <div className="mt-auto space-y-2 pt-5">
        <div className="rounded-xl border border-success/20 bg-success-soft/70 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-success"><GoogleLogo className="size-4" />Gmail conectado</div>
          <p className="mt-1.5 truncate text-[11px] text-foreground-muted" title={connectedEmail}>{connectedEmail}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50 motion-reduce:transition-none">
          <RefreshCw aria-hidden="true" className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} />Actualizar
        </button>
        <Link href="/integrations/gmail" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-foreground-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none">
          <Settings2 aria-hidden="true" className="size-4" />Administrar Gmail
        </Link>
      </div>
    </nav>
  );
}

export function GmailMailboxWorkspace({
  attachmentMaxBytes,
  projectId,
  connectedEmail,
  canSend,
  initialRecipients,
}: {
  attachmentMaxBytes: number;
  projectId: string;
  connectedEmail: string;
  canSend: boolean;
  initialRecipients: string[];
}) {
  const [folder, setFolder] = useState<GmailMailboxFolder>("INBOX");
  const [threads, setThreads] = useState<GmailThreadSummary[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(initialRecipients);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GmailThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mailboxError, setMailboxError] = useState<ApiError | null>(null);
  const [detailError, setDetailError] = useState<ApiError | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const mailboxAbortRef = useRef<AbortController | null>(null);
  const threadAbortRef = useRef<AbortController | null>(null);
  const mailboxRequestRef = useRef(0);
  const threadRequestRef = useRef(0);
  const threadCacheRef = useRef(new Map<string, GmailThreadDetail>());

  const loadMailbox = useCallback(async ({ append = false, pageToken = null }: { append?: boolean; pageToken?: string | null } = {}) => {
    mailboxAbortRef.current?.abort();
    const controller = new AbortController();
    mailboxAbortRef.current = controller;
    const requestId = ++mailboxRequestRef.current;
    setLoading(true);
    setMailboxError(null);
    try {
      const queryParams = new URLSearchParams({ projectId, folder });
      if (append && pageToken) queryParams.set("pageToken", pageToken);
      const response = await fetch(`/api/integrations/gmail/mailbox?${queryParams}`, { cache: "no-store", signal: controller.signal });
      const result: { data?: GmailMailboxPage } & ApiError = await response.json();
      if (!response.ok || !result.data) throw result;
      if (requestId !== mailboxRequestRef.current) return;
      setThreads((current) => append
        ? [...new Map([...current, ...result.data!.threads].map((item) => [item.id, item])).values()]
        : result.data!.threads);
      setNextPageToken(result.data.nextPageToken);
      setRecipients(result.data.recipients);
      if (!append) threadCacheRef.current.clear();
    } catch (caught) {
      if (controller.signal.aborted || requestId !== mailboxRequestRef.current) return;
      setMailboxError(!navigator.onLine
        ? { code: "NETWORK_OFFLINE" }
        : caught && typeof caught === "object" ? caught as ApiError : { message: "No fue posible actualizar los correos." });
    } finally {
      if (requestId === mailboxRequestRef.current) setLoading(false);
    }
  }, [folder, projectId]);

  const loadThread = useCallback(async (threadId: string, force = false) => {
    threadAbortRef.current?.abort();
    const cached = threadCacheRef.current.get(threadId);
    setSelectedId(threadId);
    setDetailError(null);
    if (cached && !force) {
      setDetail(cached);
      setLoadingDetail(false);
      return;
    }

    const controller = new AbortController();
    threadAbortRef.current = controller;
    const requestId = ++threadRequestRef.current;
    setLoadingDetail(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/integrations/gmail/threads/${encodeURIComponent(threadId)}?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal });
      const result: { data?: GmailThreadDetail } & ApiError = await response.json();
      if (!response.ok || !result.data) throw result;
      if (requestId !== threadRequestRef.current) return;
      threadCacheRef.current.set(threadId, result.data);
      setDetail(result.data);
    } catch (caught) {
      if (controller.signal.aborted || requestId !== threadRequestRef.current) return;
      setDetailError(caught && typeof caught === "object" ? caught as ApiError : { message: "No fue posible abrir la conversación." });
    } finally {
      if (requestId === threadRequestRef.current) setLoadingDetail(false);
    }
  }, [projectId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadMailbox(), 0);
    return () => window.clearTimeout(kickoff);
  }, [loadMailbox]);

  useEffect(() => () => {
    mailboxAbortRef.current?.abort();
    threadAbortRef.current?.abort();
  }, []);

  const refreshMailbox = useCallback(() => {
    void loadMailbox();
  }, [loadMailbox]);

  const loadMore = useCallback(() => {
    if (nextPageToken) void loadMailbox({ append: true, pageToken: nextPageToken });
  }, [loadMailbox, nextPageToken]);

  const changeFolder = useCallback((value: GmailMailboxFolder) => {
    threadAbortRef.current?.abort();
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setThreads([]);
    setNextPageToken(null);
    setQuery("");
    if (value === folder) void loadMailbox();
    else setFolder(value);
  }, [folder, loadMailbox]);

  const closeThread = useCallback(() => {
    threadAbortRef.current?.abort();
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const presentedError = useMemo(() => errorPresentation(mailboxError), [mailboxError]);

  return (
    <div className="mx-auto max-w-[1600px]">
      <h1 className="sr-only">Correo</h1>
      {notice && (
        <div role="status" aria-live="polite" className="mb-3 flex items-center justify-between rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-sm text-success">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="grid size-8 place-items-center rounded-md hover:bg-surface/70" aria-label="Cerrar aviso"><X aria-hidden="true" className="size-4" /></button>
        </div>
      )}
      {presentedError && (
        <div role="alert" className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold text-foreground">{presentedError.title}</p><p className="mt-0.5 text-sm text-foreground-muted">{presentedError.message}</p></div>
          <div className="flex shrink-0 items-center gap-2">
            {presentedError.action && <Link href="/integrations/gmail" className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-sm font-semibold text-brand hover:bg-brand-soft">Reconectar Gmail</Link>}
            {!presentedError.action && <Button variant="secondary" onClick={refreshMailbox} className="gap-2"><RefreshCw aria-hidden="true" className="size-4" />Reintentar</Button>}
          </div>
        </div>
      )}

      <section
        className="h-[calc(100dvh-6.5rem)] min-h-[34rem] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_3px_rgba(16,24,40,0.05)] sm:h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-10rem)]"
        aria-label="Bandeja de correo"
      >
        <div className="grid h-full min-h-0 xl:grid-cols-[12rem_minmax(17rem,0.72fr)_minmax(0,1.35fr)] md:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.3fr)]">
          <MailNavigation
            canSend={canSend}
            connectedEmail={connectedEmail}
            folder={folder}
            loading={loading}
            onCompose={() => setComposeOpen(true)}
            onFolderChange={changeFolder}
            onRefresh={refreshMailbox}
          />

          <div className={cn("min-h-0 min-w-0 border-border md:border-r", selectedId && "hidden md:block")}>
            <div className="flex items-center gap-2 border-b border-border p-2 xl:hidden">
              <div className="min-w-0 flex-1"><FolderButtons compact folder={folder} onChange={changeFolder} /></div>
              {canSend && (
                <IconButton label="Redactar correo" tooltipSide="bottom" onClick={() => setComposeOpen(true)} className="shrink-0 border border-border">
                  <MailPlus aria-hidden="true" className="size-4" />
                </IconButton>
              )}
            </div>
            <div className="h-[calc(100%_-_3.5rem)] xl:h-full">
              <ConversationList
                folder={folder}
                loading={loading}
                nextPageToken={nextPageToken}
                onLoadMore={loadMore}
                onRefresh={refreshMailbox}
                onSelect={loadThread}
                query={query}
                selectedId={selectedId}
                setQuery={setQuery}
                threads={threads}
              />
            </div>
          </div>

          <div className={cn("min-h-0 min-w-0 bg-surface", !selectedId && "hidden md:block")}>
            <ThreadReader
              key={selectedId ?? "empty-thread"}
              attachmentMaxBytes={attachmentMaxBytes}
              detail={detail}
              error={detailError}
              loading={loadingDetail}
              projectId={projectId}
              onBack={closeThread}
              onRetry={() => { if (selectedId) void loadThread(selectedId, true); }}
              onReplySent={() => {
                setNotice("Respuesta aceptada por Gmail.");
                if (selectedId) {
                  threadCacheRef.current.delete(selectedId);
                  void loadThread(selectedId, true);
                }
                void loadMailbox();
              }}
            />
          </div>
        </div>
      </section>

      {composeOpen && (
        <ComposeDialog
          attachmentMaxBytes={attachmentMaxBytes}
          recipients={recipients}
          from={connectedEmail}
          projectId={projectId}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setNotice("Correo aceptado por Gmail.");
            changeFolder("SENT");
          }}
        />
      )}
    </div>
  );
}
