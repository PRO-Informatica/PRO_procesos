export type GmailMailboxFolder = "INBOX" | "SENT";

export type GmailAttachmentSummary = {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  previewable: boolean;
};

export type GmailMailboxMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  sentAt: string;
  snippet: string;
  body: string;
  messageIdHeader: string | null;
  referencesHeader: string | null;
  attachments: GmailAttachmentSummary[];
  direction: "RECEIVED" | "SENT";
};

export type GmailThreadSummary = {
  id: string;
  counterpart: string;
  subject: string;
  snippet: string;
  sentAt: string;
  messageCount: number;
  hasAttachments: boolean;
};

export type GmailMailboxPage = {
  folder: GmailMailboxFolder;
  threads: GmailThreadSummary[];
  nextPageToken: string | null;
  recipients: string[];
};

export type GmailThreadDetail = {
  id: string;
  subject: string;
  messages: GmailMailboxMessage[];
  replyAvailable: boolean;
};

export type GmailApiHeader = { name?: string | null; value?: string | null };
export type GmailApiPart = {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailApiHeader[] | null;
  body?: {
    attachmentId?: string | null;
    size?: number | null;
    data?: string | null;
  } | null;
  parts?: GmailApiPart[] | null;
};

export type GmailApiMessage = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  internalDate?: string | null;
  payload?: GmailApiPart | null;
};

export type GmailSendIntentStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "UNKNOWN";

export type GmailSendIntentRow = {
  id: string;
  user_id: string;
  project_id: string;
  idempotency_key: string;
  kind: "NEW_MESSAGE" | "REPLY";
  recipients: string[];
  subject: string;
  content_hash: string;
  status: GmailSendIntentStatus;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  error_code: string | null;
};
