export const GMAIL_ALLOWED_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".xls",
  ".xlsx",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
] as const;

export const GMAIL_ATTACHMENT_ACCEPT = [
  ...GMAIL_ALLOWED_ATTACHMENT_EXTENSIONS,
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "image/jpeg",
  "image/png",
].join(",");

export const GMAIL_MAX_ATTACHMENT_COUNT = 5;
export const GMAIL_MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const GMAIL_MAX_ENCODED_MESSAGE_BYTES = 24 * 1024 * 1024;
export const GMAIL_MULTIPART_REQUEST_MAX_BYTES =
  GMAIL_MAX_TOTAL_ATTACHMENT_BYTES + 512 * 1024;

export const GMAIL_PREVIEWABLE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export const GMAIL_ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  ...GMAIL_PREVIEWABLE_MIME_TYPES,
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);
