import "server-only";

import { randomUUID } from "node:crypto";
import { google } from "googleapis";

import { validateApplicationAccess } from "@/features/auth/application-access";
import {
  CORPORATE_EMAIL_DOMAIN,
  hasExactCorporateDomain,
  normalizeEmail,
} from "@/features/auth/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  decryptRefreshToken,
  encryptRefreshToken,
  generateOAuthState,
  hashOAuthState,
} from "./crypto-core";
import {
  canPreserveStoredRefreshToken,
  getGmailReconnectionTemporalFields,
  hasAllRequiredGmailScopes,
  isInvalidGrant,
  normalizeGrantedScopes,
  resolveGmailConnectionId,
  validateGoogleIdentity,
  validateGoogleIdTokenIdentity,
} from "./policy";
import { getGmailServerEnvironment } from "./server-environment";
import {
  GMAIL_REQUIRED_SCOPES,
  type GmailConnectionPublicStatus,
  type GmailConnectionRow,
  type GmailOAuthStateRow,
} from "./types";

type GmailConnectionStoreOperation = "insert" | "reconnect_update";

const SAFE_GMAIL_CONNECTION_CONSTRAINTS = [
  "gmail_connections_dates_ck",
  "gmail_connections_google_user_id_ck",
  "gmail_connections_email_normalized_ck",
  "gmail_connections_encryption_key_version_ck",
  "gmail_connections_scopes_ck",
  "gmail_connections_token_parts_ck",
  "gmail_connections_status_ck",
  "gmail_connections_user_uq",
  "gmail_connections_google_user_uq",
] as const;

function reportGmailConnectionStoreFailure(
  error: unknown,
  operation: GmailConnectionStoreOperation,
) {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown })
      : null;
  const diagnosticText = [candidate?.message, candidate?.details, candidate?.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const constraint =
    SAFE_GMAIL_CONNECTION_CONSTRAINTS.find((name) => diagnosticText.includes(name)) ??
    null;
  const code =
    typeof candidate?.code === "string" && /^[0-9A-Z]{5}$/u.test(candidate.code)
      ? candidate.code
      : null;

  console.error("[gmail-oauth] connection_store_failed", {
    operation,
    code,
    constraint,
  });
}

export class GmailReauthenticationRequiredError extends Error {
  constructor() {
    super("GMAIL_REAUTHENTICATION_REQUIRED");
    this.name = "GmailReauthenticationRequiredError";
  }
}

export type GmailRequestUser = {
  id: string;
  email: string;
};

export async function getAuthorizedGmailRequestUser(): Promise<GmailRequestUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user?.email_confirmed_at) return null;
  const email = normalizeEmail(user.email);
  if (!hasExactCorporateDomain(email)) return null;
  const access = await validateApplicationAccess(user.id);
  return access.authorized ? { id: user.id, email } : null;
}

export function createGmailOAuthClient() {
  const environment = getGmailServerEnvironment();
  return new google.auth.OAuth2(
    environment.clientId,
    environment.clientSecret,
    environment.redirectUri,
  );
}

export async function createGmailAuthorizationRequest(user: GmailRequestUser) {
  const state = generateOAuthState();
  const admin = createAdminClient();
  const { error } = await admin.from("gmail_oauth_states").insert({
    user_id: user.id,
    state_hash: state.hash,
    expires_at: state.expiresAt,
  });
  if (error) throw new Error("GMAIL_STATE_STORE_FAILED");

  const oauth = createGmailOAuthClient();
  return {
    state: state.value,
    authorizationUrl: oauth.generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      login_hint: user.email,
      hd: CORPORATE_EMAIL_DOMAIN,
      scope: [...GMAIL_REQUIRED_SCOPES],
      state: state.value,
    }),
  };
}

export async function consumeGmailOAuthState(userId: string, state: string) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("gmail_oauth_states")
    .update({ consumed_at: now })
    .eq("user_id", userId)
    .eq("state_hash", hashOAuthState(state))
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("id, user_id, state_hash, expires_at, consumed_at, created_at")
    .maybeSingle<GmailOAuthStateRow>();
  if (error) throw new Error("GMAIL_STATE_CONSUME_FAILED");
  return Boolean(data);
}

export async function getGmailConnectionRow(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gmail_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<GmailConnectionRow>();
  if (error) throw new Error("GMAIL_CONNECTION_READ_FAILED");
  return data;
}

export async function getGmailConnectionPublicStatus(
  userId: string,
): Promise<GmailConnectionPublicStatus> {
  const connection = await getGmailConnectionRow(userId);
  if (!connection) {
    return {
      connected: false,
      email: null,
      status: "NOT_CONNECTED",
      lastSyncAt: null,
    };
  }
  return {
    connected: connection.status === "CONNECTED",
    email: connection.email,
    status: connection.status,
    lastSyncAt: connection.last_sync_at,
  };
}

export async function completeGmailAuthorization(input: {
  user: GmailRequestUser;
  code: string;
}) {
  const oauth = createGmailOAuthClient();
  const environment = getGmailServerEnvironment();
  const { tokens } = await oauth.getToken(input.code).catch(() => {
    throw new Error("GMAIL_TOKEN_EXCHANGE_FAILED");
  });
  oauth.setCredentials(tokens);

  try {
    if (!tokens.access_token) throw new Error("GMAIL_ACCESS_TOKEN_MISSING");
    if (!tokens.id_token) throw new Error("GMAIL_ID_TOKEN_MISSING");

    const [ticket, tokenInfo] = await Promise.all([
      oauth
        .verifyIdToken({
          idToken: tokens.id_token,
          audience: environment.clientId,
        })
        .catch(() => {
          throw new Error("GMAIL_ID_TOKEN_VERIFICATION_FAILED");
        }),
      oauth.getTokenInfo(tokens.access_token).catch(() => {
        throw new Error("GMAIL_TOKEN_INFO_FAILED");
      }),
    ]);
    const claims = ticket.getPayload();
    if (!claims) throw new Error("IDENTITY_MISSING");

    const identity = validateGoogleIdTokenIdentity({
      googleSubject: claims.sub,
      googleEmail: claims.email,
      googleEmailVerified: claims.email_verified,
      googleHostedDomain: claims.hd,
      issuer: claims.iss,
      audience: claims.aud,
      expiresAt: claims.exp,
      expectedAudience: environment.clientId,
      supabaseEmail: input.user.email,
    });
    if (!identity.valid) throw new Error(identity.reason);

    const scopes = normalizeGrantedScopes(tokenInfo.scopes);
    if (!hasAllRequiredGmailScopes(scopes)) {
      throw new Error("GMAIL_SCOPES_INCOMPLETE");
    }

    const existing = await getGmailConnectionRow(input.user.id);
    const connectionId = resolveGmailConnectionId(existing?.id, randomUUID);
    if (
      existing &&
      (existing.google_user_id !== identity.googleUserId ||
        normalizeEmail(existing.email) !== identity.email)
    ) {
      throw new Error("GOOGLE_ACCOUNT_MISMATCH");
    }
    const refreshToken = tokens.refresh_token ?? undefined;
    let encrypted: ReturnType<typeof encryptRefreshToken> | null = null;

    if (refreshToken) {
      try {
        encrypted = encryptRefreshToken({
          refreshToken,
          encryptionKeyBase64: environment.tokenEncryptionKeyBase64,
          userId: input.user.id,
          connectionId,
          keyVersion: environment.encryptionKeyVersion,
        });
      } catch {
        throw new Error("GMAIL_TOKEN_ENCRYPTION_FAILED");
      }
    } else if (
      !canPreserveStoredRefreshToken({
        hasStoredToken: Boolean(
          existing?.encrypted_refresh_token &&
            existing.encryption_iv &&
            existing.encryption_auth_tag,
        ),
        storedGoogleUserId: existing?.google_user_id ?? null,
        storedEmail: existing?.email ?? null,
        googleUserId: identity.googleUserId,
        email: identity.email,
      })
    ) {
      throw new Error("GMAIL_REFRESH_TOKEN_REQUIRED");
    }

    const now = new Date().toISOString();
    const tokenFields = {
      encrypted_refresh_token:
        encrypted?.ciphertext ?? existing?.encrypted_refresh_token,
      encryption_iv: encrypted?.iv ?? existing?.encryption_iv,
      encryption_auth_tag: encrypted?.authTag ?? existing?.encryption_auth_tag,
      encryption_key_version:
        encrypted?.keyVersion ?? existing?.encryption_key_version ?? 1,
    };
    const commonFields = {
      google_user_id: identity.googleUserId,
      email: identity.email,
      ...tokenFields,
      granted_scopes: scopes,
      status: "CONNECTED" as const,
    };
    const admin = createAdminClient();
    if (existing) {
      const { data, error } = await admin
        .from("gmail_connections")
        .update({
          ...tokenFields,
          granted_scopes: scopes,
          status: "CONNECTED",
          ...getGmailReconnectionTemporalFields(now),
        })
        .eq("id", existing.id)
        .eq("user_id", input.user.id)
        .select("id")
        .maybeSingle<{ id: string }>();
      if (error || data?.id !== existing.id) {
        reportGmailConnectionStoreFailure(error, "reconnect_update");
        throw new Error("GMAIL_CONNECTION_STORE_FAILED");
      }
    } else {
      const { data, error } = await admin
        .from("gmail_connections")
        .insert({
          id: connectionId,
          user_id: input.user.id,
          ...commonFields,
        })
        .select("id")
        .single<{ id: string }>();
      if (error || data?.id !== connectionId) {
        reportGmailConnectionStoreFailure(error, "insert");
        throw new Error("GMAIL_CONNECTION_STORE_FAILED");
      }
    }
    return { connected: true as const, email: identity.email };
  } finally {
    tokens.access_token = undefined;
    tokens.refresh_token = undefined;
    tokens.id_token = undefined;
    oauth.setCredentials({});
  }
}

async function markGmailReauthenticationRequired(
  userId: string,
  connectionId: string,
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("gmail_connections")
    .update({
      status: "REAUTH_REQUIRED",
      encrypted_refresh_token: null,
      encryption_iv: null,
      encryption_auth_tag: null,
      reauth_required_at: new Date().toISOString(),
      disconnected_at: null,
    })
    .eq("id", connectionId)
    .eq("user_id", userId);
  if (error) throw new Error("GMAIL_REAUTH_STORE_FAILED");
}

export async function getAuthorizedGmailClient(userId: string) {
  const connection = await getGmailConnectionRow(userId);
  if (
    !connection ||
    connection.status !== "CONNECTED" ||
    !connection.encrypted_refresh_token ||
    !connection.encryption_iv ||
    !connection.encryption_auth_tag
  ) {
    throw new GmailReauthenticationRequiredError();
  }

  const environment = getGmailServerEnvironment();
  let refreshToken = decryptRefreshToken({
    ciphertext: connection.encrypted_refresh_token,
    iv: connection.encryption_iv,
    authTag: connection.encryption_auth_tag,
    encryptionKeyBase64: environment.tokenEncryptionKeyBase64,
    userId,
    connectionId: connection.id,
    keyVersion: connection.encryption_key_version,
  });
  const oauth = createGmailOAuthClient();
  oauth.setCredentials({ refresh_token: refreshToken });
  refreshToken = "";

  try {
    await oauth.getAccessToken();
    const admin = createAdminClient();
    const { error } = await admin
      .from("gmail_connections")
      .update({ last_token_refresh_at: new Date().toISOString() })
      .eq("id", connection.id)
      .eq("user_id", userId);
    if (error) {
      oauth.setCredentials({});
      throw new Error("GMAIL_TOKEN_REFRESH_STORE_FAILED");
    }
    return { oauth, connection };
  } catch (error) {
    oauth.setCredentials({});
    if (isInvalidGrant(error)) {
      await markGmailReauthenticationRequired(userId, connection.id);
      throw new GmailReauthenticationRequiredError();
    }
    throw new Error("GMAIL_TOKEN_REFRESH_FAILED");
  }
}

export async function verifyAuthorizedGmailIdentity(userId: string) {
  const { oauth, connection } = await getAuthorizedGmailClient(userId);
  try {
    const response = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
    const identity = validateGoogleIdentity({
      googleUserId: response.data.id,
      googleEmail: response.data.email,
      googleEmailVerified: response.data.verified_email,
      supabaseEmail: connection.email,
    });
    if (
      !identity.valid ||
      identity.googleUserId !== connection.google_user_id
    ) {
      await markGmailReauthenticationRequired(userId, connection.id);
      throw new GmailReauthenticationRequiredError();
    }
    return { email: identity.email };
  } finally {
    oauth.setCredentials({});
  }
}

export async function disconnectGmail(userId: string) {
  const connection = await getGmailConnectionRow(userId);
  if (!connection || connection.status === "DISCONNECTED") {
    return { disconnected: true as const };
  }

  if (
    connection.encrypted_refresh_token &&
    connection.encryption_iv &&
    connection.encryption_auth_tag
  ) {
    let refreshToken = "";
    try {
      const environment = getGmailServerEnvironment();
      refreshToken = decryptRefreshToken({
        ciphertext: connection.encrypted_refresh_token,
        iv: connection.encryption_iv,
        authTag: connection.encryption_auth_tag,
        encryptionKeyBase64: environment.tokenEncryptionKeyBase64,
        userId,
        connectionId: connection.id,
        keyVersion: connection.encryption_key_version,
      });
      const oauth = createGmailOAuthClient();
      await oauth.revokeToken(refreshToken);
    } catch {
      // Local invalidation is mandatory even when Google is unavailable.
    } finally {
      refreshToken = "";
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("gmail_connections")
    .update({
      status: "DISCONNECTED",
      encrypted_refresh_token: null,
      encryption_iv: null,
      encryption_auth_tag: null,
      reauth_required_at: null,
      disconnected_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("user_id", userId);
  if (error) throw new Error("GMAIL_DISCONNECT_STORE_FAILED");
  return { disconnected: true as const };
}
