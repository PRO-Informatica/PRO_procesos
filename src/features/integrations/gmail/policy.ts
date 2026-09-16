import {
  CORPORATE_EMAIL_DOMAIN,
  hasExactCorporateDomain,
  normalizeEmail,
} from "../../auth/security.ts";

import { GMAIL_REQUIRED_SCOPES } from "./types.ts";

export function normalizeGrantedScopes(value: string | string[] | null | undefined) {
  const entries = Array.isArray(value) ? value : value?.split(/\s+/u) ?? [];
  const aliases: Record<string, string> = {
    "https://www.googleapis.com/auth/userinfo.email": "email",
    "https://www.googleapis.com/auth/userinfo.profile": "profile",
  };
  return [
    ...new Set(
      entries
        .map((scope) => scope.trim())
        .filter(Boolean)
        .map((scope) => aliases[scope] ?? scope),
    ),
  ].sort();
}

export function hasAllRequiredGmailScopes(scopes: string[]) {
  const granted = new Set(scopes);
  return GMAIL_REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

const GOOGLE_ID_TOKEN_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

export function validateGoogleIdentity(input: {
  googleUserId: string | null | undefined;
  googleEmail: string | null | undefined;
  googleEmailVerified: boolean | null | undefined;
  supabaseEmail: string | null | undefined;
}) {
  const googleEmail = normalizeEmail(input.googleEmail);
  const supabaseEmail = normalizeEmail(input.supabaseEmail);
  if (!input.googleUserId?.trim()) {
    return { valid: false, reason: "IDENTITY_MISSING" } as const;
  }
  if (!input.googleEmailVerified) {
    return { valid: false, reason: "EMAIL_UNVERIFIED" } as const;
  }
  if (!hasExactCorporateDomain(googleEmail)) {
    return { valid: false, reason: "DOMAIN_NOT_ALLOWED" } as const;
  }
  if (googleEmail !== supabaseEmail) {
    return { valid: false, reason: "EMAIL_MISMATCH" } as const;
  }
  return {
    valid: true,
    googleUserId: input.googleUserId.trim(),
    email: googleEmail,
  } as const;
}

export function validateGoogleIdTokenIdentity(input: {
  googleSubject: string | null | undefined;
  googleEmail: string | null | undefined;
  googleEmailVerified: boolean | null | undefined;
  googleHostedDomain: string | null | undefined;
  issuer: string | null | undefined;
  audience: string | null | undefined;
  expiresAt: number | null | undefined;
  expectedAudience: string;
  supabaseEmail: string | null | undefined;
  nowSeconds?: number;
}) {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!input.googleSubject?.trim()) {
    return { valid: false, reason: "IDENTITY_MISSING" } as const;
  }
  if (!input.issuer || !GOOGLE_ID_TOKEN_ISSUERS.has(input.issuer)) {
    return { valid: false, reason: "ID_TOKEN_ISSUER_INVALID" } as const;
  }
  if (input.audience !== input.expectedAudience) {
    return { valid: false, reason: "ID_TOKEN_AUDIENCE_INVALID" } as const;
  }
  if (!input.expiresAt || input.expiresAt <= nowSeconds) {
    return { valid: false, reason: "ID_TOKEN_EXPIRED" } as const;
  }
  if (input.googleHostedDomain?.trim().toLowerCase() !== CORPORATE_EMAIL_DOMAIN) {
    return { valid: false, reason: "HOSTED_DOMAIN_NOT_ALLOWED" } as const;
  }
  return validateGoogleIdentity({
    googleUserId: input.googleSubject,
    googleEmail: input.googleEmail,
    googleEmailVerified: input.googleEmailVerified,
    supabaseEmail: input.supabaseEmail,
  });
}

export function canPreserveStoredRefreshToken(input: {
  hasStoredToken: boolean;
  storedGoogleUserId: string | null;
  storedEmail: string | null;
  googleUserId: string;
  email: string;
}) {
  return (
    input.hasStoredToken &&
    input.storedGoogleUserId === input.googleUserId &&
    normalizeEmail(input.storedEmail) === normalizeEmail(input.email)
  );
}

export function resolveGmailConnectionId(
  existingConnectionId: string | null | undefined,
  generateConnectionId: () => string,
) {
  return existingConnectionId ?? generateConnectionId();
}

export function getGmailReconnectionTemporalFields(connectedAt: string) {
  return {
    connected_at: connectedAt,
    last_token_refresh_at: connectedAt,
    last_sync_at: null,
    reauth_required_at: null,
    disconnected_at: null,
  };
}

export function isInvalidGrant(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: string | number;
    message?: string;
    response?: { data?: { error?: string } };
  };
  return (
    candidate.response?.data?.error === "invalid_grant" ||
    candidate.code === "invalid_grant" ||
    candidate.message?.toLowerCase().includes("invalid_grant") === true
  );
}
