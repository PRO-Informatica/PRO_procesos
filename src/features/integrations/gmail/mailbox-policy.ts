import type {
  GmailApiMessage,
  GmailMailboxFolder,
} from "./mailbox-types.ts";

export const GMAIL_MAILBOX_PAGE_SIZE = 20;
export const GMAIL_MAILBOX_MAX_CONCURRENCY = 5;
export const GMAIL_SUBJECT_MAX_LENGTH = 200;
export const GMAIL_BODY_MAX_LENGTH = 50_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const GMAIL_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const GMAIL_ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,4096}$/u;
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function isSafeGmailId(value: string) {
  return GMAIL_ID_PATTERN.test(value);
}

export function isSafeGmailAttachmentId(value: string) {
  return GMAIL_ATTACHMENT_ID_PATTERN.test(value);
}

export function isSafeGmailPageToken(value: string | null) {
  return value === null || PAGE_TOKEN_PATTERN.test(value);
}

export function normalizeMailboxEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeMailboxEmailList(values: string[]) {
  return [...new Set(values.map(normalizeMailboxEmail).filter((value) => EMAIL_PATTERN.test(value)))].sort();
}

export function extractHeaderEmails(value: string | null | undefined) {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu) ?? [];
  return normalizeMailboxEmailList(matches);
}

export function getHeader(
  message: GmailApiMessage,
  name: string,
) {
  const expected = name.toLowerCase();
  return message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === expected,
  )?.value ?? null;
}

export function isAllowedIncomingMessage(
  message: GmailApiMessage,
  allowedSenders: string[],
) {
  const labels = new Set(message.labelIds ?? []);
  if (!labels.has("INBOX") || labels.has("SPAM") || labels.has("TRASH")) return false;
  const from = extractHeaderEmails(getHeader(message, "From"));
  const allowed = new Set(normalizeMailboxEmailList(allowedSenders));
  return from.length === 1 && allowed.has(from[0]);
}

export function isAllowedSentMessage(
  message: GmailApiMessage,
  allowedRecipients: string[],
) {
  const labels = new Set(message.labelIds ?? []);
  if (!labels.has("SENT") || labels.has("TRASH")) return false;
  const to = extractHeaderEmails(getHeader(message, "To"));
  const allowed = new Set(normalizeMailboxEmailList(allowedRecipients));
  return to.some((email) => allowed.has(email));
}

export function isAllowedConversationMessage(
  message: GmailApiMessage,
  allowedSenders: string[],
  allowedRecipients: string[],
) {
  return (
    isAllowedIncomingMessage(message, allowedSenders) ||
    isAllowedSentMessage(message, allowedRecipients)
  );
}

export function isAllowedMailboxMessage(input: {
  message: GmailApiMessage;
  folder: GmailMailboxFolder;
  allowedSenders: string[];
  allowedRecipients: string[];
}) {
  return input.folder === "INBOX"
    ? isAllowedIncomingMessage(input.message, input.allowedSenders)
    : isAllowedSentMessage(input.message, input.allowedRecipients);
}

export function buildGmailMailboxQuery(
  folder: GmailMailboxFolder,
  allowedEmails: string[],
) {
  const normalized = normalizeMailboxEmailList(allowedEmails);
  if (normalized.length === 0) return null;
  const operator = folder === "INBOX" ? "from" : "to";
  const addressQuery = normalized.map((email) => `${operator}:${email}`).join(" OR ");
  return `(${addressQuery}) -in:trash${folder === "INBOX" ? " -in:spam" : ""}`;
}

export function validateComposeInput(input: {
  recipient: unknown;
  subject: unknown;
  body: unknown;
  idempotencyKey: unknown;
}, allowedRecipients: string[]) {
  const recipient = typeof input.recipient === "string" ? normalizeMailboxEmail(input.recipient) : "";
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (!EMAIL_PATTERN.test(recipient) || !normalizeMailboxEmailList(allowedRecipients).includes(recipient)) {
    return { valid: false, reason: "RECIPIENT_NOT_ALLOWED" } as const;
  }
  if (!subject || subject.length > GMAIL_SUBJECT_MAX_LENGTH || /[\r\n]/u.test(subject)) {
    return { valid: false, reason: "SUBJECT_INVALID" } as const;
  }
  if (!body || body.length > GMAIL_BODY_MAX_LENGTH) {
    return { valid: false, reason: "BODY_INVALID" } as const;
  }
  if (!isUuid(idempotencyKey)) {
    return { valid: false, reason: "IDEMPOTENCY_KEY_INVALID" } as const;
  }
  return { valid: true, recipient, subject, body, idempotencyKey } as const;
}

export function classifyGmailReadRetry(error: unknown) {
  if (!error || typeof error !== "object") return { retryable: false, retryAfterMs: null };
  const candidate = error as {
    code?: number | string;
    response?: { status?: number; headers?: Record<string, string>; data?: { error?: { errors?: Array<{ reason?: string }> } } };
  };
  const status = Number(candidate.response?.status ?? candidate.code ?? 0);
  const reason = candidate.response?.data?.error?.errors?.[0]?.reason ?? "";
  const retryable = status === 429 || status >= 500 || ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason);
  const retryAfter = candidate.response?.headers?.["retry-after"];
  const retryAfterMs = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) * 1000 : null;
  return { retryable, retryAfterMs };
}

export function getBackoffDelayMs(attempt: number, randomValue = Math.random()) {
  return Math.min(4_000, 250 * 2 ** attempt) + Math.floor(randomValue * 150);
}
