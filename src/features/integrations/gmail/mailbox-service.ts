import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import { google } from "googleapis";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  GmailAttachmentValidationError,
  type ValidatedGmailAttachment,
  validateGmailAttachment,
  validateOutgoingGmailAttachments,
} from "./attachment-validation";

import {
  getAuthorizedGmailClient,
  getAuthorizedGmailRequestUser,
  GmailReauthenticationRequiredError,
} from "./service";
import { getGmailServerEnvironment } from "./server-environment";
import { getGmailProjectAccess } from "./server-access";
import type {
  GmailApiMessage,
  GmailMailboxFolder,
  GmailMailboxPage,
  GmailSendIntentRow,
  GmailThreadDetail,
  GmailThreadSummary,
} from "./mailbox-types";
import {
  GMAIL_MAILBOX_MAX_CONCURRENCY,
  GMAIL_MAILBOX_PAGE_SIZE,
  buildGmailMailboxQuery,
  classifyGmailReadRetry,
  getBackoffDelayMs,
  isAllowedConversationMessage,
  isAllowedMailboxMessage,
  isSafeGmailAttachmentId,
  isSafeGmailId,
  isSafeGmailPageToken,
  isUuid,
  normalizeMailboxEmailList,
  validateComposeInput,
} from "./mailbox-policy";
import {
  buildPlainTextMime,
  buildReplyReferences,
  decodeBase64Url,
  findGmailAttachmentPart,
  hashSendContent,
  isSafeMessageIdHeader,
  mapGmailMessage,
  normalizeReplySubject,
} from "./mailbox-mime";

export class GmailMailboxError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(code);
    this.name = "GmailMailboxError";
  }
}

async function requireMailboxActor(
  projectId: string,
  permission: "gmail.mailbox.view" | "gmail.mail.send",
) {
  if (!isUuid(projectId)) throw new GmailMailboxError("PROJECT_INVALID", 400);
  const user = await getAuthorizedGmailRequestUser();
  if (!user) throw new GmailMailboxError("SESSION_REQUIRED", 401);
  const access = await getGmailProjectAccess({
    userId: user.id,
    projectId,
    permission,
  });
  if (!access) {
    throw new GmailMailboxError("MAILBOX_PERMISSION_REQUIRED", 403);
  }
  return { user, scope: access.scope };
}

async function withReadRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const classification = classifyGmailReadRetry(error);
      if (!classification.retryable || attempt === 2) throw error;
      await delay(classification.retryAfterMs ?? getBackoffDelayMs(attempt));
    }
  }
  throw lastError;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  mapper: (value: T) => Promise<R>,
  concurrency = GMAIL_MAILBOX_MAX_CONCURRENCY,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index]);
      }
    }),
  );
  return results;
}

function publicErrorFromGoogle(error: unknown): never {
  if (error instanceof GmailReauthenticationRequiredError) {
    throw new GmailMailboxError("GMAIL_REAUTH_REQUIRED", 401);
  }
  const classification = classifyGmailReadRetry(error);
  if (classification.retryable) {
    throw new GmailMailboxError("GMAIL_RATE_LIMITED", 429);
  }
  const status = Number(
    error && typeof error === "object"
      ? (error as { code?: unknown; response?: { status?: unknown } }).response?.status ??
        (error as { code?: unknown }).code ?? 0
      : 0,
  );
  if (status === 401) throw new GmailMailboxError("GMAIL_REAUTH_REQUIRED", 401);
  throw new GmailMailboxError("GMAIL_TEMPORARY_ERROR", 502);
}

function messageTimestamp(message: ReturnType<typeof mapGmailMessage>) {
  return message ? Date.parse(message.sentAt) || 0 : 0;
}

function summarizeThread(input: {
  id: string;
  rawMessages: GmailApiMessage[];
  folder: GmailMailboxFolder;
  allowedSenders: string[];
  allowedRecipients: string[];
}): GmailThreadSummary | null {
  const visible = input.rawMessages
    .filter((message) => isAllowedMailboxMessage({
      message,
      folder: input.folder,
      allowedSenders: input.allowedSenders,
      allowedRecipients: input.allowedRecipients,
    }))
    .map((message) => mapGmailMessage(message, input.allowedSenders))
    .filter((message): message is NonNullable<typeof message> => Boolean(message))
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left));
  const latest = visible[0];
  if (!latest) return null;
  const counterpart = input.folder === "INBOX"
    ? latest.from
    : latest.to.filter((email) => input.allowedRecipients.includes(email)).join(", ");
  return {
    id: input.id,
    counterpart: counterpart || "Destinatario permitido",
    subject: latest.subject,
    snippet: latest.snippet,
    sentAt: latest.sentAt,
    messageCount: visible.length,
    hasAttachments: visible.some((message) => message.attachments.length > 0),
  };
}

async function updateLastSync(userId: string, connectionId: string) {
  await createAdminClient()
    .from("gmail_connections")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("user_id", userId);
}

export async function listOperationalMailbox(input: {
  projectId: string;
  folder: GmailMailboxFolder;
  pageToken: string | null;
}): Promise<GmailMailboxPage> {
  const { user } = await requireMailboxActor(input.projectId, "gmail.mailbox.view");
  if (!isSafeGmailPageToken(input.pageToken)) {
    throw new GmailMailboxError("PAGE_TOKEN_INVALID", 400);
  }
  const environment = getGmailServerEnvironment();
  const configured = input.folder === "INBOX"
    ? environment.allowedSenders
    : environment.recipientEmails;
  if (configured.length === 0) {
    throw new GmailMailboxError(
      input.folder === "INBOX" ? "SENDERS_NOT_CONFIGURED" : "RECIPIENTS_NOT_CONFIGURED",
      503,
    );
  }
  const query = buildGmailMailboxQuery(input.folder, configured);
  if (!query) throw new GmailMailboxError("MAILBOX_CONFIGURATION_MISSING", 503);

  let authorized: Awaited<ReturnType<typeof getAuthorizedGmailClient>> | null = null;
  try {
    authorized = await getAuthorizedGmailClient(user.id);
    const gmail = google.gmail({ version: "v1", auth: authorized.oauth });
    const list = await withReadRetry(() => gmail.users.threads.list({
      userId: "me",
      labelIds: [input.folder],
      q: query,
      includeSpamTrash: false,
      maxResults: GMAIL_MAILBOX_PAGE_SIZE,
      pageToken: input.pageToken ?? undefined,
    }));
    const threadIds = (list.data.threads ?? [])
      .map((thread) => thread.id ?? "")
      .filter(isSafeGmailId);
    const threads = await mapWithConcurrency(threadIds, async (threadId) => {
      const result = await withReadRetry(() => gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      }));
      return summarizeThread({
        id: threadId,
        rawMessages: (result.data.messages ?? []) as GmailApiMessage[],
        folder: input.folder,
        allowedSenders: environment.allowedSenders,
        allowedRecipients: environment.recipientEmails,
      });
    });
    await updateLastSync(user.id, authorized.connection.id);
    return {
      folder: input.folder,
      threads: threads
        .filter((thread): thread is GmailThreadSummary => Boolean(thread))
        .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt)),
      nextPageToken: list.data.nextPageToken ?? null,
      recipients: environment.recipientEmails,
    };
  } catch (error) {
    if (error instanceof GmailMailboxError) throw error;
    return publicErrorFromGoogle(error);
  } finally {
    authorized?.oauth.setCredentials({});
  }
}

async function getVisibleThread(input: {
  userId: string;
  threadId: string;
}) {
  if (!isSafeGmailId(input.threadId)) throw new GmailMailboxError("THREAD_INVALID", 400);
  const environment = getGmailServerEnvironment();
  const authorized = await getAuthorizedGmailClient(input.userId);
  try {
    const gmail = google.gmail({ version: "v1", auth: authorized.oauth });
    const result = await withReadRetry(() => gmail.users.threads.get({
      userId: "me",
      id: input.threadId,
      format: "full",
    }));
    const rawMessages = (result.data.messages ?? []) as GmailApiMessage[];
    const messages = rawMessages
      .filter((message) => isAllowedConversationMessage(
        message,
        environment.allowedSenders,
        environment.recipientEmails,
      ))
      .map((message) => mapGmailMessage(message, environment.allowedSenders))
      .filter((message): message is NonNullable<typeof message> => Boolean(message))
      .sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
    if (messages.length === 0) throw new GmailMailboxError("THREAD_NOT_ALLOWED", 404);
    return { gmail, authorized, environment, rawMessages, messages };
  } catch (error) {
    authorized.oauth.setCredentials({});
    if (error instanceof GmailMailboxError) throw error;
    publicErrorFromGoogle(error);
  }
}

export async function getOperationalThread(projectId: string, threadId: string): Promise<GmailThreadDetail> {
  const { user } = await requireMailboxActor(projectId, "gmail.mailbox.view");
  const result = await getVisibleThread({ userId: user.id, threadId });
  try {
    const latest = result.messages.at(-1)!;
    return {
      id: threadId,
      subject: latest.subject,
      messages: result.messages,
      replyAvailable: isSafeMessageIdHeader(latest.messageIdHeader),
    };
  } finally {
    result.authorized.oauth.setCredentials({});
  }
}

export async function downloadOperationalAttachment(input: {
  projectId: string;
  messageId: string;
  attachmentId: string;
}) {
  const { user } = await requireMailboxActor(input.projectId, "gmail.mailbox.view");
  if (!isSafeGmailId(input.messageId) || !isSafeGmailAttachmentId(input.attachmentId)) {
    throw new GmailMailboxError("ATTACHMENT_INVALID", 400);
  }
  const environment = getGmailServerEnvironment();
  if (environment.attachmentMaxBytes === null) {
    throw new GmailMailboxError("ATTACHMENT_CONFIGURATION_MISSING", 503);
  }
  const authorized = await getAuthorizedGmailClient(user.id);
  try {
    const gmail = google.gmail({ version: "v1", auth: authorized.oauth });
    const messageResult = await withReadRetry(() => gmail.users.messages.get({
      userId: "me",
      id: input.messageId,
      format: "full",
    }));
    const rawMessage = messageResult.data as GmailApiMessage;
    if (!isAllowedConversationMessage(rawMessage, environment.allowedSenders, environment.recipientEmails)) {
      throw new GmailMailboxError("ATTACHMENT_NOT_ALLOWED", 404);
    }
    const attachmentPart = findGmailAttachmentPart(
      input.messageId,
      rawMessage.payload,
      input.attachmentId,
    );
    if (!attachmentPart) throw new GmailMailboxError("ATTACHMENT_UNAVAILABLE", 404);
    if (attachmentPart.size > environment.attachmentMaxBytes) {
      throw new GmailMailboxError("ATTACHMENT_TOO_LARGE", 413);
    }
    const encodedData = attachmentPart.external
      ? (await withReadRetry(() => gmail.users.messages.attachments.get({
          userId: "me",
          messageId: input.messageId,
          id: input.attachmentId,
        }))).data.data
      : attachmentPart.data;
    if (!encodedData) throw new GmailMailboxError("ATTACHMENT_UNAVAILABLE", 404);
    let bytes: Buffer;
    try {
      bytes = decodeBase64Url(encodedData);
    } catch {
      throw new GmailMailboxError("ATTACHMENT_UNAVAILABLE", 404);
    }
    if (bytes.byteLength > environment.attachmentMaxBytes) {
      throw new GmailMailboxError("ATTACHMENT_TOO_LARGE", 413);
    }
    const attachment = await validateGmailAttachment({
      fileName: attachmentPart.fileName,
      mimeType: attachmentPart.mimeType,
      bytes,
      maxBytes: environment.attachmentMaxBytes,
    });
    return {
      attachment: {
        ...attachmentPart,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        previewable: attachment.previewable,
      },
      bytes,
    };
  } catch (error) {
    if (error instanceof GmailMailboxError) throw error;
    if (error instanceof GmailAttachmentValidationError) {
      throw new GmailMailboxError(error.code, error.httpStatus);
    }
    const googleStatus = Number(
      error && typeof error === "object"
        ? (error as { code?: unknown; response?: { status?: unknown } }).response?.status ??
          (error as { code?: unknown }).code ?? 0
        : 0,
    );
    if (googleStatus === 404) throw new GmailMailboxError("ATTACHMENT_UNAVAILABLE", 404);
    publicErrorFromGoogle(error);
  } finally {
    authorized.oauth.setCredentials({});
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505");
}

async function reserveSendIntent(input: {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  kind: "NEW_MESSAGE" | "REPLY";
  recipient: string;
  subject: string;
  contentHash: string;
}) {
  const admin = createAdminClient();
  const payload = {
    user_id: input.userId,
    project_id: input.projectId,
    idempotency_key: input.idempotencyKey,
    kind: input.kind,
    recipients: [input.recipient],
    subject: input.subject,
    content_hash: input.contentHash,
  };
  const inserted = await admin
    .from("gmail_send_intents")
    .insert(payload)
    .select("id, user_id, project_id, idempotency_key, kind, recipients, subject, content_hash, status, gmail_message_id, gmail_thread_id, error_code")
    .single<GmailSendIntentRow>();
  if (inserted.error) {
    if (!isUniqueViolation(inserted.error)) throw new GmailMailboxError("SEND_RESERVATION_FAILED", 500);
    const existing = await admin
      .from("gmail_send_intents")
      .select("id, user_id, project_id, idempotency_key, kind, recipients, subject, content_hash, status, gmail_message_id, gmail_thread_id, error_code")
      .eq("user_id", input.userId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle<GmailSendIntentRow>();
    if (existing.error || !existing.data) throw new GmailMailboxError("SEND_RESERVATION_FAILED", 500);
    if (
      existing.data.project_id !== input.projectId ||
      existing.data.kind !== input.kind ||
      existing.data.content_hash !== input.contentHash
    ) {
      throw new GmailMailboxError("IDEMPOTENCY_CONFLICT", 409);
    }
    if (existing.data.status === "SENT") {
      return { duplicate: true as const, intent: existing.data };
    }
    throw new GmailMailboxError(
      existing.data.status === "UNKNOWN" ? "SEND_RESULT_UNKNOWN" : "SEND_ALREADY_PROCESSING",
      409,
    );
  }
  const now = new Date().toISOString();
  const sending = await admin
    .from("gmail_send_intents")
    .update({ status: "SENDING", sending_at: now })
    .eq("id", inserted.data.id)
    .eq("user_id", input.userId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (sending.error || sending.data?.id !== inserted.data.id) {
    throw new GmailMailboxError("SEND_RESERVATION_FAILED", 500);
  }
  return { duplicate: false as const, intent: inserted.data };
}

async function finishSendIntent(input: {
  id: string;
  userId: string;
  status: "SENT" | "FAILED" | "UNKNOWN";
  messageId?: string;
  threadId?: string;
  errorCode?: string;
}) {
  const now = new Date().toISOString();
  const fields = input.status === "SENT"
    ? {
        status: "SENT",
        gmail_message_id: input.messageId,
        gmail_thread_id: input.threadId,
        sent_at: now,
        error_code: null,
      }
    : input.status === "FAILED"
      ? { status: "FAILED", failed_at: now, error_code: input.errorCode ?? "SEND_REJECTED" }
      : { status: "UNKNOWN", error_code: input.errorCode ?? "SEND_RESULT_UNKNOWN" };
  const result = await createAdminClient()
    .from("gmail_send_intents")
    .update(fields)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("status", "SENDING")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (result.error || result.data?.id !== input.id) {
    throw new GmailMailboxError("SEND_RESULT_STORE_FAILED", 500);
  }
}

function isConfirmedSendRejection(error: unknown) {
  const status = Number(
    error && typeof error === "object"
      ? (error as { code?: unknown; response?: { status?: unknown } }).response?.status ??
        (error as { code?: unknown }).code ?? 0
      : 0,
  );
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function sendWithoutRetry(input: {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  kind: "NEW_MESSAGE" | "REPLY";
  recipient: string;
  subject: string;
  body: string;
  attachments: ValidatedGmailAttachment[];
  raw: string;
  threadId?: string;
  oauth: Awaited<ReturnType<typeof getAuthorizedGmailClient>>["oauth"];
}) {
  const contentHash = hashSendContent({
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    threadId: input.threadId ?? null,
    attachments: input.attachments,
  });
  const reservation = await reserveSendIntent({ ...input, contentHash });
  if (reservation.duplicate) {
    return { sent: true as const, duplicate: true as const };
  }
  try {
    const gmail = google.gmail({ version: "v1", auth: input.oauth });
    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: input.raw,
        threadId: input.threadId,
      },
    });
    if (!result.data.id || !result.data.threadId) {
      await finishSendIntent({
        id: reservation.intent.id,
        userId: input.userId,
        status: "UNKNOWN",
      });
      throw new GmailMailboxError("SEND_RESULT_UNKNOWN", 502);
    }
    await finishSendIntent({
      id: reservation.intent.id,
      userId: input.userId,
      status: "SENT",
      messageId: result.data.id,
      threadId: result.data.threadId,
    });
    return { sent: true as const, duplicate: false as const };
  } catch (error) {
    if (error instanceof GmailMailboxError) throw error;
    const confirmed = isConfirmedSendRejection(error);
    await finishSendIntent({
      id: reservation.intent.id,
      userId: input.userId,
      status: confirmed ? "FAILED" : "UNKNOWN",
      errorCode: confirmed ? "GMAIL_SEND_REJECTED" : "GMAIL_SEND_AMBIGUOUS",
    });
    throw new GmailMailboxError(
      confirmed ? "GMAIL_SEND_REJECTED" : "SEND_RESULT_UNKNOWN",
      confirmed ? 400 : 502,
    );
  }
}

function formString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function formFiles(formData: FormData) {
  const values = formData.getAll("attachments");
  if (values.some((value) => typeof value === "string")) {
    throw new GmailMailboxError("ATTACHMENT_INVALID", 400);
  }
  return values as File[];
}

async function validatedFormAttachments(formData: FormData, maxBytes: number | null) {
  try {
    return await validateOutgoingGmailAttachments(formFiles(formData), maxBytes);
  } catch (error) {
    if (error instanceof GmailAttachmentValidationError) {
      const status = error.code === "ATTACHMENT_CONFIGURATION_MISSING"
        ? 503
        : error.httpStatus;
      throw new GmailMailboxError(error.code, status);
    }
    throw error;
  }
}

type GmailMultipartBodyLoader = () => Promise<FormData>;

export async function sendOperationalEmail(
  projectId: string,
  loadBody: GmailMultipartBodyLoader,
) {
  const { user } = await requireMailboxActor(projectId, "gmail.mail.send");
  const environment = getGmailServerEnvironment();
  if (environment.recipientEmails.length === 0) {
    throw new GmailMailboxError("RECIPIENTS_NOT_CONFIGURED", 503);
  }
  const formData = await loadBody();
  const validated = validateComposeInput({
    recipient: formString(formData, "recipient"),
    subject: formString(formData, "subject"),
    body: formString(formData, "body"),
    idempotencyKey: formString(formData, "idempotencyKey"),
  }, environment.recipientEmails);
  if (!validated.valid) throw new GmailMailboxError(validated.reason, 400);
  const attachments = await validatedFormAttachments(formData, environment.attachmentMaxBytes);
  const authorized = await getAuthorizedGmailClient(user.id).catch(publicErrorFromGoogle);
  try {
    const raw = buildPlainTextMime({
      from: authorized.connection.email,
      to: validated.recipient,
      subject: validated.subject,
      body: validated.body,
      attachments,
    });
    return await sendWithoutRetry({
      userId: user.id,
      projectId,
      idempotencyKey: validated.idempotencyKey,
      kind: "NEW_MESSAGE",
      recipient: validated.recipient,
      subject: validated.subject,
      body: validated.body,
      attachments,
      raw,
      oauth: authorized.oauth,
    });
  } finally {
    authorized.oauth.setCredentials({});
  }
}

export async function replyOperationalEmail(
  projectId: string,
  loadBody: GmailMultipartBodyLoader,
) {
  const { user } = await requireMailboxActor(projectId, "gmail.mail.send");
  const formData = await loadBody();
  const threadId = formString(formData, "threadId");
  const visible = await getVisibleThread({ userId: user.id, threadId });
  try {
    const latest = visible.messages.at(-1)!;
    if (!isSafeMessageIdHeader(latest.messageIdHeader)) {
      throw new GmailMailboxError("REPLY_CONTEXT_INVALID", 409);
    }
    const allowedRecipients = normalizeMailboxEmailList(visible.environment.recipientEmails);
    const recipient = latest.direction === "RECEIVED"
      ? latest.from
      : latest.to.find((email) => allowedRecipients.includes(email)) ?? "";
    const subject = normalizeReplySubject(latest.subject);
    const validated = validateComposeInput({
      recipient,
      subject,
      body: formString(formData, "body"),
      idempotencyKey: formString(formData, "idempotencyKey"),
    }, allowedRecipients);
    if (!validated.valid) throw new GmailMailboxError(validated.reason, 400);
    const attachments = await validatedFormAttachments(
      formData,
      visible.environment.attachmentMaxBytes,
    );
    const references = buildReplyReferences(latest.referencesHeader, latest.messageIdHeader);
    const raw = buildPlainTextMime({
      from: visible.authorized.connection.email,
      to: validated.recipient,
      subject,
      body: validated.body,
      inReplyTo: latest.messageIdHeader,
      references,
      attachments,
    });
    return await sendWithoutRetry({
      userId: user.id,
      projectId,
      idempotencyKey: validated.idempotencyKey,
      kind: "REPLY",
      recipient: validated.recipient,
      subject,
      body: validated.body,
      attachments,
      raw,
      threadId,
      oauth: visible.authorized.oauth,
    });
  } finally {
    visible.authorized.oauth.setCredentials({});
  }
}

export function getMailboxPublicError(error: unknown) {
  if (!(error instanceof GmailMailboxError)) {
    return { status: 500, code: "MAILBOX_UNAVAILABLE", message: "No fue posible completar la operación de correo." };
  }
  const messages: Record<string, string> = {
    SESSION_REQUIRED: "Tu sesión ya no está disponible.",
    MAILBOX_PERMISSION_REQUIRED: "No tienes permiso para utilizar esta bandeja.",
    GMAIL_REAUTH_REQUIRED: "Gmail requiere reconexión.",
    SENDERS_NOT_CONFIGURED: "La lista de remitentes permitidos no está configurada.",
    RECIPIENTS_NOT_CONFIGURED: "La lista de destinatarios permitidos no está configurada.",
    GMAIL_RATE_LIMITED: "Se alcanzó temporalmente el límite de Gmail.",
    SEND_RESULT_UNKNOWN: "No fue posible confirmar si el correo fue enviado.",
    SEND_ALREADY_PROCESSING: "Este correo ya se está procesando.",
    IDEMPOTENCY_CONFLICT: "La solicitud de envío no es válida.",
    ATTACHMENT_INVALID: "El identificador del adjunto no es válido.",
    ATTACHMENT_NOT_ALLOWED: "Este adjunto no está permitido.",
    ATTACHMENT_UNAVAILABLE: "El adjunto no está disponible.",
    ATTACHMENT_TOO_LARGE: "El adjunto supera el tamaño permitido.",
    ATTACHMENT_TOTAL_TOO_LARGE: "El tamaño total de los adjuntos supera el límite permitido.",
    ATTACHMENT_ENCODED_TOO_LARGE: "El correo sería demasiado grande para enviarse.",
    ATTACHMENT_COUNT_EXCEEDED: "Seleccionaste demasiados archivos.",
    ATTACHMENT_TYPE_NOT_ALLOWED: "El tipo de archivo no está permitido.",
    ATTACHMENT_SIGNATURE_INVALID: "El contenido del archivo no coincide con su tipo.",
    ATTACHMENT_NAME_INVALID: "El nombre del archivo no es válido.",
    ATTACHMENT_CONFIGURATION_MISSING: "Los adjuntos no están configurados para este ambiente.",
  };
  return {
    status: error.httpStatus,
    code: error.code,
    message: messages[error.code] ?? "No fue posible completar la operación de correo.",
  };
}
