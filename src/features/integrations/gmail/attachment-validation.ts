import { createHash } from "node:crypto";

import JSZip from "jszip";

import {
  GMAIL_ALLOWED_ATTACHMENT_MIME_TYPES,
  GMAIL_MAX_ATTACHMENT_COUNT,
  GMAIL_MAX_ENCODED_MESSAGE_BYTES,
  GMAIL_MAX_TOTAL_ATTACHMENT_BYTES,
  GMAIL_PREVIEWABLE_MIME_TYPES,
} from "./attachment-constants.ts";
import { sanitizeAttachmentFileName } from "./mailbox-mime.ts";

const MIME_BY_EXTENSION = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".csv", "text/csv"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

export type ValidatedGmailAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  bytes: Buffer;
  previewable: boolean;
};

export class GmailAttachmentValidationError extends Error {
  readonly code: string;
  readonly httpStatus: 400 | 413 | 415;

  constructor(
    code: string,
    httpStatus: 400 | 413 | 415,
  ) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = "GmailAttachmentValidationError";
  }
}

function extensionOf(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function startsWith(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function containsMacroMarker(bytes: Buffer) {
  const binary = bytes.toString("latin1");
  const utf16 = bytes.toString("utf16le");
  return ["_VBA_PROJECT", "VBA", "Macros", "PROJECTwm"]
    .some((marker) => binary.includes(marker) || utf16.includes(marker));
}

async function hasValidSignature(mimeType: string, bytes: Buffer) {
  if (mimeType === "application/pdf") {
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  if (mimeType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "application/vnd.ms-excel") {
    return (
      startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) &&
      !containsMacroMarker(bytes)
    );
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
    try {
      const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
      return Boolean(
        archive.file("[Content_Types].xml") &&
        archive.file("xl/workbook.xml") &&
        !archive.file(/(^|\/)vbaProject\.bin$/iu).length,
      );
    } catch {
      return false;
    }
  }
  if (mimeType === "text/csv") {
    if (bytes.includes(0)) return false;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return !/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text);
    } catch {
      return false;
    }
  }
  return false;
}

export async function validateGmailAttachment(input: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  maxBytes: number;
}): Promise<ValidatedGmailAttachment> {
  if (
    !input.fileName ||
    /[\r\n\\/]/u.test(input.fileName) ||
    input.fileName.includes("..")
  ) {
    throw new GmailAttachmentValidationError("ATTACHMENT_NAME_INVALID", 415);
  }
  const fileName = sanitizeAttachmentFileName(input.fileName);
  const mimeType = input.mimeType.trim().toLowerCase();
  const expectedMime = MIME_BY_EXTENSION.get(extensionOf(fileName));
  if (
    !expectedMime ||
    expectedMime !== mimeType ||
    !GMAIL_ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)
  ) {
    throw new GmailAttachmentValidationError("ATTACHMENT_TYPE_NOT_ALLOWED", 415);
  }
  if (input.bytes.byteLength > input.maxBytes) {
    throw new GmailAttachmentValidationError("ATTACHMENT_TOO_LARGE", 413);
  }
  if (input.bytes.byteLength === 0 || !(await hasValidSignature(mimeType, input.bytes))) {
    throw new GmailAttachmentValidationError("ATTACHMENT_SIGNATURE_INVALID", 415);
  }
  return {
    fileName,
    mimeType,
    size: input.bytes.byteLength,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    bytes: input.bytes,
    previewable: GMAIL_PREVIEWABLE_MIME_TYPES.has(mimeType),
  };
}

export async function validateOutgoingGmailAttachments(
  files: File[],
  maxBytes: number | null,
) {
  if (files.length === 0) return [];
  if (maxBytes === null) {
    throw new GmailAttachmentValidationError("ATTACHMENT_CONFIGURATION_MISSING", 400);
  }
  if (files.length > GMAIL_MAX_ATTACHMENT_COUNT) {
    throw new GmailAttachmentValidationError("ATTACHMENT_COUNT_EXCEEDED", 413);
  }
  const declaredTotal = files.reduce((sum, file) => sum + file.size, 0);
  if (declaredTotal > GMAIL_MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new GmailAttachmentValidationError("ATTACHMENT_TOTAL_TOO_LARGE", 413);
  }
  const validated = await Promise.all(files.map(async (file) => validateGmailAttachment({
    fileName: file.name,
    mimeType: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
    maxBytes,
  })));
  const encodedEstimate = validated.reduce(
    (sum, attachment) => sum + Math.ceil(attachment.size / 3) * 4 + 1_024,
    64 * 1024,
  );
  if (encodedEstimate > GMAIL_MAX_ENCODED_MESSAGE_BYTES) {
    throw new GmailAttachmentValidationError("ATTACHMENT_ENCODED_TOO_LARGE", 413);
  }
  return validated;
}
