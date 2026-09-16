import { createHash, randomBytes } from "node:crypto";

import type {
  GmailApiMessage,
  GmailApiPart,
  GmailAttachmentSummary,
  GmailMailboxMessage,
} from "./mailbox-types.ts";
import {
  extractHeaderEmails,
  getHeader,
  isAllowedIncomingMessage,
} from "./mailbox-policy.ts";
import {
  GMAIL_ALLOWED_ATTACHMENT_MIME_TYPES,
  GMAIL_PREVIEWABLE_MIME_TYPES,
} from "./attachment-constants.ts";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

export function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new Error("BASE64URL_INVALID");
  }
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

export function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function decodeBytes(bytes: Buffer, charset: string) {
  const normalized = charset.trim().toLowerCase();
  try {
    return new TextDecoder(
      normalized === "iso-8859-1" || normalized === "latin1" ? "windows-1252" : normalized,
    ).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

export function decodeRfc2047Header(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(
    /=\?([^?\s]+)\?([bqBQ])\?([^?]*)\?=/gu,
    (_match, charset: string, encoding: string, content: string) => {
      try {
        const bytes = encoding.toLowerCase() === "b"
          ? Buffer.from(content, "base64")
          : Buffer.from(
              content
                .replace(/_/gu, " ")
                .replace(/=([0-9A-F]{2})/giu, (_value, hex: string) =>
                  String.fromCharCode(Number.parseInt(hex, 16))),
              "binary",
            );
        return decodeBytes(bytes, charset);
      } catch {
        return "";
      }
    },
  ).replace(/\?=\s+=\?/gu, "?==?").replace(CONTROL_CHARACTERS, "").trim();
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_match, entity: string) => {
    const numeric = entity.startsWith("#x")
      ? Number.parseInt(entity.slice(2), 16)
      : entity.startsWith("#") ? Number.parseInt(entity.slice(1), 10) : null;
    if (numeric !== null) {
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : "";
    }
    return named[entity.toLowerCase()] ?? "";
  });
}

export function htmlToSafeText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|svg|iframe|form|object|embed|template)[^>]*>[\s\S]*?<\/\1\s*>/giu, "")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/giu, "\n")
      .replace(/<[^>]+>/gu, ""),
  )
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function getCharset(part: GmailApiPart) {
  const contentType = part.headers?.find(
    (header) => header.name?.toLowerCase() === "content-type",
  )?.value;
  return contentType?.match(/charset=["']?([^;"'\s]+)/iu)?.[1] ?? "utf-8";
}

function walkParts(part: GmailApiPart | null | undefined, output: GmailApiPart[] = []) {
  if (!part) return output;
  const pending = [part];
  while (pending.length > 0 && output.length < 500) {
    const current = pending.shift()!;
    output.push(current);
    pending.unshift(...(current.parts ?? []));
  }
  return output;
}

function decodePartBody(part: GmailApiPart) {
  if (!part.body?.data) return "";
  try {
    return decodeBytes(decodeBase64Url(part.body.data), getCharset(part))
      .replace(CONTROL_CHARACTERS, "")
      .trim();
  } catch {
    return "";
  }
}

export function extractSafeMessageBody(payload: GmailApiPart | null | undefined) {
  const parts = walkParts(payload);
  const plain = parts.find(
    (part) => part.mimeType?.toLowerCase() === "text/plain" && part.body?.data,
  );
  if (plain) return decodePartBody(plain);
  const html = parts.find(
    (part) => part.mimeType?.toLowerCase() === "text/html" && part.body?.data,
  );
  return html ? htmlToSafeText(decodePartBody(html)) : "";
}

export function sanitizeAttachmentFileName(value: string) {
  const decoded = decodeRfc2047Header(value)
    .replace(/[\\/]/gu, "_")
    .replace(/\.\.+/gu, ".")
    .replace(CONTROL_CHARACTERS, "")
    .trim();
  return (decoded || "adjunto").slice(0, 180);
}

function inlineAttachmentId(path: number[], part: GmailApiPart) {
  return `inline_${createHash("sha256")
    .update(JSON.stringify([path, part.partId ?? "", part.filename ?? "", part.mimeType ?? ""]))
    .digest("base64url")}`;
}

export type GmailAttachmentPart = GmailAttachmentSummary & {
  data: string | null;
  external: boolean;
};

export function findGmailAttachmentPart(
  messageId: string,
  payload: GmailApiPart | null | undefined,
  requestedId: string,
): GmailAttachmentPart | null {
  if (!payload) return null;
  const pending: Array<{ part: GmailApiPart; path: number[] }> = [{ part: payload, path: [] }];
  let visited = 0;
  while (pending.length > 0 && visited < 500) {
    const { part, path } = pending.pop()!;
    visited += 1;
    const hasAttachmentBody = Boolean(part.body?.attachmentId || part.body?.data);
    if (part.filename && hasAttachmentBody) {
      const id = part.body?.attachmentId || inlineAttachmentId(path, part);
      if (id === requestedId) {
        const mimeType = part.mimeType?.trim().toLowerCase() || "application/octet-stream";
        return {
          id,
          messageId,
          fileName: sanitizeAttachmentFileName(part.filename),
          mimeType,
          size: Math.max(0, part.body?.size ?? 0),
          previewable: GMAIL_PREVIEWABLE_MIME_TYPES.has(mimeType),
          data: part.body?.data ?? null,
          external: Boolean(part.body?.attachmentId),
        };
      }
    }
    (part.parts ?? []).forEach((child, index) => {
      pending.push({ part: child, path: [...path, index] });
    });
  }
  return null;
}

export function extractAttachmentSummaries(
  messageId: string,
  payload: GmailApiPart | null | undefined,
): GmailAttachmentSummary[] {
  if (!payload) return [];
  const summaries: GmailAttachmentSummary[] = [];
  const pending: Array<{ part: GmailApiPart; path: number[] }> = [{ part: payload, path: [] }];
  let visited = 0;
  while (pending.length > 0 && visited < 500) {
    const { part, path } = pending.pop()!;
    visited += 1;
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      const mimeType = part.mimeType?.trim().toLowerCase() || "application/octet-stream";
      if (GMAIL_ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        summaries.push({
          id: part.body?.attachmentId || inlineAttachmentId(path, part),
          messageId,
          fileName: sanitizeAttachmentFileName(part.filename),
          mimeType,
          size: Math.max(0, part.body?.size ?? 0),
          previewable: GMAIL_PREVIEWABLE_MIME_TYPES.has(mimeType),
        });
      }
    }
    (part.parts ?? []).forEach((child, index) => {
      pending.push({ part: child, path: [...path, index] });
    });
  }
  return summaries;
}

function cleanSnippet(value: string) {
  return htmlToSafeText(value).replace(/\s+/gu, " ").slice(0, 220);
}

export function mapGmailMessage(
  message: GmailApiMessage,
  allowedSenders: string[],
): GmailMailboxMessage | null {
  if (!message.id || !message.threadId) return null;
  const from = extractHeaderEmails(getHeader(message, "From"))[0] ?? "Remitente autorizado";
  const to = extractHeaderEmails(getHeader(message, "To"));
  const internalDate = Number(message.internalDate ?? 0);
  const headerDate = Date.parse(getHeader(message, "Date") ?? "");
  const timestamp = Number.isFinite(internalDate) && internalDate > 0
    ? internalDate
    : Number.isFinite(headerDate) ? headerDate : 0;
  const body = extractSafeMessageBody(message.payload);
  return {
    id: message.id,
    threadId: message.threadId,
    from,
    to,
    subject: decodeRfc2047Header(getHeader(message, "Subject")) || "Sin asunto",
    sentAt: new Date(timestamp || 0).toISOString(),
    snippet: cleanSnippet(message.snippet || body),
    body,
    messageIdHeader: getHeader(message, "Message-ID")?.trim() || null,
    referencesHeader: getHeader(message, "References")?.trim() || null,
    attachments: extractAttachmentSummaries(message.id, message.payload),
    direction: isAllowedIncomingMessage(message, allowedSenders) ? "RECEIVED" : "SENT",
  };
}

function assertSafeHeader(value: string, field: string) {
  if (!value.trim() || /[\r\n]/u.test(value)) throw new Error(`${field}_INVALID`);
}

function encodeHeader(value: string) {
  const chunks: string[] = [];
  let current = "";
  for (const character of value) {
    if (current && Buffer.byteLength(current + character, "utf8") > 36) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? "";
}

export function buildPlainTextMime(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  }>;
  boundary?: string;
}) {
  assertSafeHeader(input.from, "FROM");
  assertSafeHeader(input.to, "TO");
  assertSafeHeader(input.subject, "SUBJECT");
  if (input.inReplyTo) assertSafeHeader(input.inReplyTo, "IN_REPLY_TO");
  if (input.references) assertSafeHeader(input.references, "REFERENCES");
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  const encodedBody = wrapBase64(Buffer.from(input.body, "utf8").toString("base64"));
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    headers.push(
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    );
    return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${encodedBody}\r\n`);
  }
  const boundary = input.boundary ?? `pro_${randomBytes(24).toString("hex")}`;
  if (!/^[A-Za-z0-9_-]{24,80}$/u.test(boundary)) throw new Error("BOUNDARY_INVALID");
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n`,
  ];
  for (const attachment of attachments) {
    const fileName = sanitizeAttachmentFileName(attachment.fileName);
    if (
      !fileName ||
      /[\r\n]/u.test(fileName) ||
      !/^[a-z]+\/[a-z0-9.+-]+$/iu.test(attachment.mimeType)
    ) {
      throw new Error("ATTACHMENT_HEADER_INVALID");
    }
    const fallback = fileName.replace(/[^a-zA-Z0-9._-]/gu, "_") || "adjunto";
    const encodedName = encodeURIComponent(fileName).replace(/['()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: ${attachment.mimeType}; name="${fallback}"\r\n` +
      "Content-Transfer-Encoding: base64\r\n" +
      `Content-Disposition: attachment; filename="${fallback}"; filename*=UTF-8''${encodedName}\r\n\r\n` +
      `${wrapBase64(attachment.bytes.toString("base64"))}\r\n`,
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${parts.join("")}`);
}

export function buildReplyReferences(references: string | null, messageId: string) {
  if (!isSafeMessageIdHeader(messageId)) throw new Error("MESSAGE_ID_INVALID");
  const safeReferences = references && /^(?:<[^<>\s]{1,480}>\s*)+$/u.test(references.trim())
    ? references.trim()
    : "";
  return `${safeReferences ? `${safeReferences} ` : ""}${messageId.trim()}`.slice(-900);
}

export function isSafeMessageIdHeader(value: string | null | undefined): value is string {
  return Boolean(value && /^<[^<>\s]{1,480}>$/u.test(value.trim()));
}

export function normalizeReplySubject(subject: string) {
  const cleaned = subject.replace(/[\r\n]/gu, " ").trim() || "Sin asunto";
  return /^re:/iu.test(cleaned) ? cleaned.slice(0, 200) : `Re: ${cleaned}`.slice(0, 200);
}

export function hashSendContent(input: {
  recipient: string;
  subject: string;
  body: string;
  threadId?: string | null;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    size: number;
    sha256: string;
  }>;
}) {
  const normalized = {
    ...input,
    attachments: (input.attachments ?? []).map((attachment) => ({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      sha256: attachment.sha256,
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized), "utf8")
    .digest("hex");
}
