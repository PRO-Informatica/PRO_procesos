import type { AppEnvironment } from "@/lib/env";

export type GmailEnvironmentSource = {
  GMAIL_GOOGLE_DEV_CLIENT_ID?: string;
  GMAIL_GOOGLE_DEV_CLIENT_SECRET?: string;
  GMAIL_GOOGLE_DEV_REDIRECT_URI?: string;
  GMAIL_DEV_TOKEN_ENCRYPTION_KEY?: string;
  GMAIL_DEV_SYNC_SECRET?: string;
  MIXTO_LISTO_DEV_RECIPIENT_EMAILS?: string;
  MIXTO_LISTO_DEV_ALLOWED_SENDERS?: string;
  GMAIL_DEV_ATTACHMENT_MAX_BYTES?: string;
  GMAIL_GOOGLE_PROD_CLIENT_ID?: string;
  GMAIL_GOOGLE_PROD_CLIENT_SECRET?: string;
  GMAIL_GOOGLE_PROD_REDIRECT_URI?: string;
  GMAIL_PROD_TOKEN_ENCRYPTION_KEY?: string;
  GMAIL_PROD_SYNC_SECRET?: string;
  MIXTO_LISTO_PROD_RECIPIENT_EMAILS?: string;
  MIXTO_LISTO_PROD_ALLOWED_SENDERS?: string;
  GMAIL_PROD_ATTACHMENT_MAX_BYTES?: string;
};

export type ResolvedGmailEnvironment = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKeyBase64: string;
  encryptionKeyVersion: number;
  syncSecretConfigured: boolean;
  recipientEmails: string[];
  allowedSenders: string[];
  attachmentMaxBytes: number | null;
};

function required(value: string | undefined, variableName: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Falta la variable de entorno ${variableName}.`);
  return normalized;
}

function parseEmailList(value: string | undefined, variableName: string) {
  if (!value?.trim()) return [];
  const emails = value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))) {
    throw new Error(`${variableName} contiene una dirección no válida.`);
  }
  return [...new Set(emails)];
}

function parseAttachmentLimit(value: string | undefined, variableName: string) {
  if (!value?.trim()) return null;
  if (!/^\d+$/u.test(value.trim())) {
    throw new Error(`${variableName} no es válido.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 25 * 1024 * 1024) {
    throw new Error(`${variableName} debe estar entre 1 byte y 25 MB.`);
  }
  return parsed;
}

export function resolveGmailEnvironment(input: {
  appEnvironment: AppEnvironment;
  appUrl: string;
  source: GmailEnvironmentSource;
}): ResolvedGmailEnvironment {
  const { appEnvironment, appUrl, source } = input;
  const selected = appEnvironment === "DEV"
    ? {
        clientId: source.GMAIL_GOOGLE_DEV_CLIENT_ID,
        clientSecret: source.GMAIL_GOOGLE_DEV_CLIENT_SECRET,
        redirectUri: source.GMAIL_GOOGLE_DEV_REDIRECT_URI,
        encryptionKey: source.GMAIL_DEV_TOKEN_ENCRYPTION_KEY,
        syncSecret: source.GMAIL_DEV_SYNC_SECRET,
        recipients: source.MIXTO_LISTO_DEV_RECIPIENT_EMAILS,
        senders: source.MIXTO_LISTO_DEV_ALLOWED_SENDERS,
        attachmentMaxBytes: source.GMAIL_DEV_ATTACHMENT_MAX_BYTES,
        names: {
          clientId: "GMAIL_GOOGLE_DEV_CLIENT_ID",
          clientSecret: "GMAIL_GOOGLE_DEV_CLIENT_SECRET",
          redirectUri: "GMAIL_GOOGLE_DEV_REDIRECT_URI",
          encryptionKey: "GMAIL_DEV_TOKEN_ENCRYPTION_KEY",
          recipients: "MIXTO_LISTO_DEV_RECIPIENT_EMAILS",
          senders: "MIXTO_LISTO_DEV_ALLOWED_SENDERS",
          attachmentMaxBytes: "GMAIL_DEV_ATTACHMENT_MAX_BYTES",
        },
      }
    : {
        clientId: source.GMAIL_GOOGLE_PROD_CLIENT_ID,
        clientSecret: source.GMAIL_GOOGLE_PROD_CLIENT_SECRET,
        redirectUri: source.GMAIL_GOOGLE_PROD_REDIRECT_URI,
        encryptionKey: source.GMAIL_PROD_TOKEN_ENCRYPTION_KEY,
        syncSecret: source.GMAIL_PROD_SYNC_SECRET,
        recipients: source.MIXTO_LISTO_PROD_RECIPIENT_EMAILS,
        senders: source.MIXTO_LISTO_PROD_ALLOWED_SENDERS,
        attachmentMaxBytes: source.GMAIL_PROD_ATTACHMENT_MAX_BYTES,
        names: {
          clientId: "GMAIL_GOOGLE_PROD_CLIENT_ID",
          clientSecret: "GMAIL_GOOGLE_PROD_CLIENT_SECRET",
          redirectUri: "GMAIL_GOOGLE_PROD_REDIRECT_URI",
          encryptionKey: "GMAIL_PROD_TOKEN_ENCRYPTION_KEY",
          recipients: "MIXTO_LISTO_PROD_RECIPIENT_EMAILS",
          senders: "MIXTO_LISTO_PROD_ALLOWED_SENDERS",
          attachmentMaxBytes: "GMAIL_PROD_ATTACHMENT_MAX_BYTES",
        },
      };

  const expectedRedirectUri = new URL(
    "/api/integrations/gmail/callback",
    appUrl,
  ).toString();
  const redirectUri = required(selected.redirectUri, selected.names.redirectUri);
  if (redirectUri !== expectedRedirectUri) {
    throw new Error(
      `${selected.names.redirectUri} no coincide con el callback confiable del ambiente.`,
    );
  }

  return {
    clientId: required(selected.clientId, selected.names.clientId),
    clientSecret: required(selected.clientSecret, selected.names.clientSecret),
    redirectUri,
    tokenEncryptionKeyBase64: required(
      selected.encryptionKey,
      selected.names.encryptionKey,
    ),
    encryptionKeyVersion: 1,
    syncSecretConfigured: Boolean(selected.syncSecret?.trim()),
    recipientEmails: parseEmailList(selected.recipients, selected.names.recipients),
    allowedSenders: parseEmailList(selected.senders, selected.names.senders),
    attachmentMaxBytes: parseAttachmentLimit(
      selected.attachmentMaxBytes,
      selected.names.attachmentMaxBytes,
    ),
  };
}
