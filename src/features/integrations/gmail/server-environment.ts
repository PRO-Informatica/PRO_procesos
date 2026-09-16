import "server-only";

import { getPublicEnvironment } from "@/lib/env";

import { resolveGmailEnvironment } from "./environment";

export function getGmailServerEnvironment() {
  const environment = getPublicEnvironment();
  return {
    ...resolveGmailEnvironment({
      appEnvironment: environment.appEnvironment,
      appUrl: environment.appUrl,
      source: {
        GMAIL_GOOGLE_DEV_CLIENT_ID: process.env.GMAIL_GOOGLE_DEV_CLIENT_ID,
        GMAIL_GOOGLE_DEV_CLIENT_SECRET:
          process.env.GMAIL_GOOGLE_DEV_CLIENT_SECRET,
        GMAIL_GOOGLE_DEV_REDIRECT_URI:
          process.env.GMAIL_GOOGLE_DEV_REDIRECT_URI,
        GMAIL_DEV_TOKEN_ENCRYPTION_KEY:
          process.env.GMAIL_DEV_TOKEN_ENCRYPTION_KEY,
        GMAIL_DEV_SYNC_SECRET: process.env.GMAIL_DEV_SYNC_SECRET,
        MIXTO_LISTO_DEV_RECIPIENT_EMAILS:
          process.env.MIXTO_LISTO_DEV_RECIPIENT_EMAILS,
        MIXTO_LISTO_DEV_ALLOWED_SENDERS:
          process.env.MIXTO_LISTO_DEV_ALLOWED_SENDERS,
        GMAIL_DEV_ATTACHMENT_MAX_BYTES:
          process.env.GMAIL_DEV_ATTACHMENT_MAX_BYTES,
        GMAIL_GOOGLE_PROD_CLIENT_ID: process.env.GMAIL_GOOGLE_PROD_CLIENT_ID,
        GMAIL_GOOGLE_PROD_CLIENT_SECRET:
          process.env.GMAIL_GOOGLE_PROD_CLIENT_SECRET,
        GMAIL_GOOGLE_PROD_REDIRECT_URI:
          process.env.GMAIL_GOOGLE_PROD_REDIRECT_URI,
        GMAIL_PROD_TOKEN_ENCRYPTION_KEY:
          process.env.GMAIL_PROD_TOKEN_ENCRYPTION_KEY,
        GMAIL_PROD_SYNC_SECRET: process.env.GMAIL_PROD_SYNC_SECRET,
        MIXTO_LISTO_PROD_RECIPIENT_EMAILS:
          process.env.MIXTO_LISTO_PROD_RECIPIENT_EMAILS,
        MIXTO_LISTO_PROD_ALLOWED_SENDERS:
          process.env.MIXTO_LISTO_PROD_ALLOWED_SENDERS,
        GMAIL_PROD_ATTACHMENT_MAX_BYTES:
          process.env.GMAIL_PROD_ATTACHMENT_MAX_BYTES,
      },
    }),
    appEnvironment: environment.appEnvironment,
    appUrl: environment.appUrl,
  };
}
