"use client";

import {
  ArrowLeft,
  ChevronDown,
  Download,
  Eye,
  Inbox,
  MailPlus,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
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

function MessageAttachments({
  attachments,
  messageId,
  projectId,
}: {
  attachments: GmailAttachmentSummary[];
  messageId: string;
  projectId: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-4 space-y-2" aria-label="Adjuntos del mensaje">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Paperclip aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{attachment.fileName}</p>
              <p className="text-xs text-foreground-muted">{attachment.mimeType} · {Math.ceil(attachment.size / 1024)} KB</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {attachment.previewable && (
              <a
                href={attachmentUrl(projectId, messageId, attachment.id, "inline")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Eye aria-hidden="true" className="size-4" />Ver
              </a>
            )}
            <a
              href={attachmentUrl(projectId, messageId, attachment.id, "attachment")}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Download aria-hidden="true" className="size-4" />Descargar
            </a>
          </div>
        </div>
      ))}
    </div>
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
        <div key={index} className="space-y-2 px-4 py-4">
          <div className="skeleton-pulse h-3 w-1/3 rounded bg-border/70" />
          <div className="skeleton-pulse h-4 w-3/4 rounded bg-border/70" />
          <div className="skeleton-pulse h-3 w-full rounded bg-border/70" />
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
      title="Redactar correo"
      description="El mensaje se enviará desde tu cuenta Gmail conectada."
      icon={MailPlus}
      onClose={close}
      pending={pending}
      size="lg"
    >
      <form onSubmit={submit}>
        <div className="space-y-4 p-4 sm:p-6">
          {message && <p className="rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-sm text-destructive">{message}</p>}
          <label className="block text-sm font-medium text-foreground">
            De
            <input value={from} readOnly className="mt-1.5 h-11 w-full rounded-lg border border-border bg-muted px-3 text-foreground-muted" />
          </label>
          <label className="block text-sm font-medium text-foreground">
            Para
            <select value={recipient} onChange={(event) => { setRecipient(event.target.value); draftChanged(); }} required className="mt-1.5 h-11 w-full rounded-lg border border-border bg-surface px-3">
              {recipients.map((email) => <option key={email} value={email}>{email}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-foreground">
            Asunto
            <input value={subject} onChange={(event) => { setSubject(event.target.value); draftChanged(); }} maxLength={200} required className="mt-1.5 h-11 w-full rounded-lg border border-border bg-surface px-3" />
          </label>
          <label className="block text-sm font-medium text-foreground">
            Mensaje
            <textarea value={body} onChange={(event) => { setBody(event.target.value); draftChanged(); }} maxLength={50_000} required rows={10} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface p-3 leading-6" />
          </label>
          <GmailAttachmentPicker
            selected={attachments}
            onChange={(files) => { setAttachments(files); draftChanged(); }}
            maxBytes={attachmentMaxBytes}
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={pending}>Cancelar</Button>
          <Button type="submit" disabled={pending || !recipient || !subject.trim() || !body.trim()} className="gap-2">
            <Send aria-hidden="true" className="size-4" />
            {pending ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ThreadReader({
  attachmentMaxBytes,
  detail,
  loading,
  projectId,
  onBack,
  onReplySent,
}: {
  attachmentMaxBytes: number;
  detail: GmailThreadDetail | null;
  loading: boolean;
  projectId: string;
  onBack: () => void;
  onReplySent: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SelectedGmailAttachment[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible responder.");
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  if (loading) {
    return <div className="p-5" role="status"><span className="sr-only">Cargando conversación…</span><MailboxSkeleton /></div>;
  }
  if (!detail) {
    return (
      <div className="grid min-h-[26rem] place-items-center p-6 text-center">
        <div><Inbox className="mx-auto size-8 text-foreground-muted/60" /><p className="mt-3 font-medium text-foreground">Selecciona una conversación</p><p className="mt-1 text-sm text-foreground-muted">Aquí verás únicamente los mensajes permitidos.</p></div>
      </div>
    );
  }

  return (
    <div className="min-h-0">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-3 py-3 sm:px-5">
        <button type="button" onClick={onBack} className="grid size-10 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label="Volver a conversaciones"><ArrowLeft className="size-5" /></button>
        <h2 className="min-w-0 flex-1 truncate font-semibold text-foreground">{detail.subject}</h2>
        {detail.replyAvailable && <Button variant="secondary" onClick={() => setReplying(true)} className="gap-2"><Reply className="size-4" /> <span className="hidden sm:inline">Responder</span></Button>}
      </div>
      <div className="space-y-4 p-3 sm:p-5">
        {detail.messages.map((item) => (
          <article key={item.id} className="rounded-xl border border-border bg-surface p-4">
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{item.direction === "RECEIVED" ? item.from : `Para: ${item.to.join(", ")}`}</p><p className="mt-0.5 text-xs text-foreground-muted">{item.direction === "RECEIVED" ? "Recibido" : "Enviado"}</p></div>
              <time className="text-xs text-foreground-muted" dateTime={item.sentAt}>{new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.sentAt))}</time>
            </header>
            <p className="whitespace-pre-wrap break-words pt-4 text-sm leading-6 text-foreground">{item.body || "Este mensaje no contiene texto visible."}</p>
            <MessageAttachments attachments={item.attachments} messageId={item.id} projectId={projectId} />
          </article>
        ))}
        {replying && (
          <form onSubmit={submitReply} className="rounded-xl border border-brand/20 bg-brand-soft/40 p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-foreground">Responder</h3><button type="button" onClick={() => { if ((!body && attachments.length === 0) || window.confirm("¿Descartar la respuesta?")) { setReplying(false); setBody(""); setAttachments([]); idempotencyKeyRef.current = null; } }} className="grid size-9 place-items-center rounded-lg hover:bg-surface" aria-label="Cerrar respuesta"><X className="size-4" /></button></div>
            {message && <p className="mt-3 text-sm text-destructive">{message}</p>}
            <textarea autoFocus value={body} onChange={(event) => { setBody(event.target.value); idempotencyKeyRef.current = null; }} required maxLength={50_000} rows={6} className="mt-3 w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-6" aria-label="Mensaje de respuesta" />
            <div className="mt-3">
              <GmailAttachmentPicker
                selected={attachments}
                onChange={(files) => { setAttachments(files); idempotencyKeyRef.current = null; }}
                maxBytes={attachmentMaxBytes}
                disabled={pending}
              />
            </div>
            <div className="mt-3 flex justify-end"><Button type="submit" disabled={pending || !body.trim()} className="gap-2"><Send className="size-4" />{pending ? "Enviando…" : "Enviar respuesta"}</Button></div>
          </form>
        )}
      </div>
    </div>
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
  const [error, setError] = useState<ApiError | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMailbox = useCallback(async (append = false) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ projectId, folder });
      if (append && nextPageToken) query.set("pageToken", nextPageToken);
      const response = await fetch(`/api/integrations/gmail/mailbox?${query}`, { cache: "no-store" });
      const result: { data?: GmailMailboxPage } & ApiError = await response.json();
      if (!response.ok || !result.data) throw result;
      setThreads((current) => append
        ? [...new Map([...current, ...result.data!.threads].map((item) => [item.id, item])).values()]
        : result.data!.threads);
      setNextPageToken(result.data.nextPageToken);
      setRecipients(result.data.recipients);
    } catch (caught) {
      setError(!navigator.onLine
        ? { code: "NETWORK_OFFLINE" }
        : caught && typeof caught === "object" ? caught as ApiError : { message: "No fue posible actualizar los correos." });
      if (!append) setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [folder, nextPageToken, projectId]);

  const loadThread = useCallback(async (threadId: string) => {
    setSelectedId(threadId);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/integrations/gmail/threads/${encodeURIComponent(threadId)}?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const result: { data?: GmailThreadDetail } & ApiError = await response.json();
      if (!response.ok || !result.data) throw new Error(result.message ?? "No fue posible abrir la conversación.");
      setDetail(result.data);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : "No fue posible abrir la conversación." });
    } finally {
      setLoadingDetail(false);
    }
  }, [projectId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadMailbox(false), 0);
    return () => window.clearTimeout(kickoff);
    // loadMailbox intentionally resets when the selected folder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, projectId]);

  function changeFolder(value: GmailMailboxFolder) {
    setSelectedId(null);
    setDetail(null);
    setThreads([]);
    setNextPageToken(null);
    if (value === folder) void loadMailbox(false);
    else setFolder(value);
  }

  const presentedError = useMemo(() => errorPresentation(error), [error]);

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Comunicación operacional</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Correo</h1><p className="mt-1 text-sm text-foreground-muted">Conversaciones autorizadas de tu cuenta corporativa.</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void loadMailbox(false)} disabled={loading} className="gap-2"><RefreshCw className={cn("size-4", loading && "animate-spin")} />Actualizar</Button>
          {canSend && <Button onClick={() => setComposeOpen(true)} disabled={recipients.length === 0} className="gap-2"><MailPlus className="size-4" />Redactar</Button>}
        </div>
      </div>

      {notice && <div role="status" className="mt-4 flex items-center justify-between rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-sm text-success"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X className="size-4" /></button></div>}
      {presentedError && (
        <div role="alert" className="mt-4 rounded-xl border border-border bg-surface p-4">
          <p className="font-semibold text-foreground">{presentedError.title}</p><p className="mt-1 text-sm text-foreground-muted">{presentedError.message}</p>
          {presentedError.action && <a href="/integrations/gmail" className="mt-3 inline-flex text-sm font-semibold text-brand hover:underline">Reconectar Gmail</a>}
        </div>
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.03)]" aria-label="Bandeja de correo">
        <div className="flex border-b border-border p-2" role="tablist" aria-label="Carpetas">
          {(["INBOX", "SENT"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={folder === value} onClick={() => changeFolder(value)} className={cn("min-h-10 flex-1 rounded-lg px-4 text-sm font-semibold transition-colors sm:flex-none", folder === value ? "bg-brand-soft text-brand-strong" : "text-foreground-muted hover:bg-muted hover:text-foreground")}>{value === "INBOX" ? "Recibidos" : "Enviados"}</button>
          ))}
        </div>
        <div className="grid min-h-[34rem] lg:grid-cols-[minmax(19rem,0.85fr)_minmax(0,1.5fr)]">
          <div className={cn("min-w-0 border-border lg:border-r", selectedId && "hidden lg:block")}>
            {loading && threads.length === 0 ? <MailboxSkeleton /> : threads.length === 0 ? (
              <div className="grid min-h-[28rem] place-items-center p-6 text-center"><div><Inbox className="mx-auto size-8 text-foreground-muted/60" /><p className="mt-3 font-medium text-foreground">{folder === "INBOX" ? "Sin correos recibidos permitidos" : "Sin correos enviados"}</p><p className="mt-1 text-sm text-foreground-muted">Usa Actualizar para consultar nuevamente.</p></div></div>
            ) : (
              <div className="divide-y divide-border" role="list" aria-label="Conversaciones">
                {threads.map((thread) => (
                  <button key={thread.id} type="button" role="listitem" onClick={() => void loadThread(thread.id)} aria-current={selectedId === thread.id ? "true" : undefined} className={cn("w-full px-4 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand", selectedId === thread.id && "bg-brand-soft/50")}>
                    <div className="flex items-start justify-between gap-3"><p className="truncate text-sm font-semibold text-foreground">{thread.counterpart}</p><time className="shrink-0 text-xs text-foreground-muted">{formatMailboxDate(thread.sentAt)}</time></div>
                    <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm font-medium text-foreground">{thread.subject}</p>{thread.messageCount > 1 && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">{thread.messageCount}</span>}{thread.hasAttachments && <Paperclip aria-label="Contiene adjuntos" className="size-3.5 shrink-0 text-foreground-muted" />}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground-muted">{thread.snippet}</p>
                  </button>
                ))}
                {nextPageToken && <div className="p-3"><Button variant="secondary" onClick={() => void loadMailbox(true)} disabled={loading} className="w-full gap-2">{loading ? "Cargando…" : "Cargar más"}<ChevronDown className="size-4" /></Button></div>}
              </div>
            )}
          </div>
          <div className={cn("min-w-0", !selectedId && "hidden lg:block")}>
            <ThreadReader attachmentMaxBytes={attachmentMaxBytes} detail={detail} loading={loadingDetail} projectId={projectId} onBack={() => { setSelectedId(null); setDetail(null); }} onReplySent={() => { setNotice("Respuesta aceptada por Gmail."); if (selectedId) void loadThread(selectedId); void loadMailbox(false); }} />
          </div>
        </div>
      </section>
      {composeOpen && <ComposeDialog attachmentMaxBytes={attachmentMaxBytes} recipients={recipients} from={connectedEmail} projectId={projectId} onClose={() => setComposeOpen(false)} onSent={() => { setNotice("Correo aceptado por Gmail."); changeFolder("SENT"); }} />}
    </div>
  );
}
