import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decryptRefreshToken,
  decodeEncryptionKey,
  encryptRefreshToken,
  generateOAuthState,
  hashOAuthState,
  isUsableOAuthState,
  secureStateEquals,
} from "../src/features/integrations/gmail/crypto-primitives.ts";
import { resolveGmailEnvironment } from "../src/features/integrations/gmail/environment.ts";
import { getGmailIndicatorPresentation } from "../src/features/integrations/gmail/indicator.ts";
import {
  canPreserveStoredRefreshToken,
  getGmailReconnectionTemporalFields,
  hasAllRequiredGmailScopes,
  isInvalidGrant,
  normalizeGrantedScopes,
  resolveGmailConnectionId,
  validateGoogleIdentity,
  validateGoogleIdTokenIdentity,
} from "../src/features/integrations/gmail/policy.ts";
import { GMAIL_REQUIRED_SCOPES } from "../src/features/integrations/gmail/types.ts";

const key = Buffer.alloc(32, 7).toString("base64");

test("selecciona únicamente la configuración Gmail del ambiente activo", () => {
  const result = resolveGmailEnvironment({
    appEnvironment: "DEV",
    appUrl: "http://localhost:3000",
    source: {
      GMAIL_GOOGLE_DEV_CLIENT_ID: "dev-client",
      GMAIL_GOOGLE_DEV_CLIENT_SECRET: "dev-secret",
      GMAIL_GOOGLE_DEV_REDIRECT_URI:
        "http://localhost:3000/api/integrations/gmail/callback",
      GMAIL_DEV_TOKEN_ENCRYPTION_KEY: key,
      MIXTO_LISTO_DEV_RECIPIENT_EMAILS:
        " Facturas@PRO.com.gt, compras@pro.com.gt ",
      MIXTO_LISTO_DEV_ALLOWED_SENDERS: "respuesta@mixtolisto.example",
      GMAIL_DEV_ATTACHMENT_MAX_BYTES: "10485760",
      GMAIL_PROD_ATTACHMENT_MAX_BYTES: "1",
    },
  });

  assert.equal(result.clientId, "dev-client");
  assert.deepEqual(result.recipientEmails, [
    "facturas@pro.com.gt",
    "compras@pro.com.gt",
  ]);
  assert.deepEqual(result.allowedSenders, ["respuesta@mixtolisto.example"]);
  assert.equal(result.attachmentMaxBytes, 10485760);

  assert.throws(
    () =>
      resolveGmailEnvironment({
        appEnvironment: "DEV",
        appUrl: "http://localhost:3000",
        source: {
          GMAIL_GOOGLE_PROD_CLIENT_ID: "prod-client",
          GMAIL_GOOGLE_PROD_CLIENT_SECRET: "prod-secret",
          GMAIL_GOOGLE_PROD_REDIRECT_URI:
            "https://prod.example/api/integrations/gmail/callback",
          GMAIL_PROD_TOKEN_ENCRYPTION_KEY: key,
        },
      }),
    /GMAIL_GOOGLE_DEV_REDIRECT_URI/u,
  );
});

test("rechaza callback Gmail distinto del origen confiable", () => {
  assert.throws(
    () =>
      resolveGmailEnvironment({
        appEnvironment: "DEV",
        appUrl: "http://localhost:3000",
        source: {
          GMAIL_GOOGLE_DEV_CLIENT_ID: "client",
          GMAIL_GOOGLE_DEV_CLIENT_SECRET: "secret",
          GMAIL_GOOGLE_DEV_REDIRECT_URI:
            "https://externo.example/api/integrations/gmail/callback",
          GMAIL_DEV_TOKEN_ENCRYPTION_KEY: key,
        },
      }),
    /callback confiable/u,
  );
});

test("PROD no acepta credenciales DEV como fallback", () => {
  assert.throws(
    () =>
      resolveGmailEnvironment({
        appEnvironment: "PROD",
        appUrl: "https://app.example.com",
        source: {
          GMAIL_GOOGLE_DEV_CLIENT_ID: "dev-client",
          GMAIL_GOOGLE_DEV_CLIENT_SECRET: "dev-secret",
          GMAIL_GOOGLE_DEV_REDIRECT_URI:
            "http://localhost:3000/api/integrations/gmail/callback",
          GMAIL_DEV_TOKEN_ENCRYPTION_KEY: key,
        },
      }),
    /GMAIL_GOOGLE_PROD_REDIRECT_URI/u,
  );
});

test("AES-256-GCM cifra, autentica y usa IV aleatorio", () => {
  const input = {
    refreshToken: "refresh-token-secreto",
    encryptionKeyBase64: key,
    userId: "usuario-1",
    connectionId: "conexion-1",
    keyVersion: 1,
  };
  const first = encryptRefreshToken(input);
  const second = encryptRefreshToken(input);

  assert.notEqual(first.ciphertext, input.refreshToken);
  assert.notEqual(first.iv, second.iv);
  assert.equal(decryptRefreshToken({ ...first, ...input }), input.refreshToken);
  assert.throws(() =>
    decryptRefreshToken({ ...first, ...input, userId: "otro-usuario" }),
  );

  const ciphertext = Buffer.from(first.ciphertext, "base64");
  ciphertext[0] ^= 1;
  assert.throws(() =>
    decryptRefreshToken({
      ...first,
      ...input,
      ciphertext: ciphertext.toString("base64"),
    }),
  );

  const tampered = Buffer.from(first.authTag, "base64");
  tampered[0] ^= 1;
  assert.throws(() =>
    decryptRefreshToken({
      ...first,
      ...input,
      authTag: tampered.toString("base64"),
    }),
  );

  const iv = Buffer.from(first.iv, "base64");
  iv[0] ^= 1;
  assert.throws(() =>
    decryptRefreshToken({
      ...first,
      ...input,
      iv: iv.toString("base64"),
    }),
  );
});

test("la clave Gmail debe ser Base64 canónico de 32 bytes", () => {
  assert.equal(decodeEncryptionKey(key).length, 32);
  assert.throws(() => decodeEncryptionKey(Buffer.alloc(31).toString("base64")));
  assert.throws(() => decodeEncryptionKey("no-es-base64"));
});

test("state Gmail es aleatorio, hasheado, expira y se compara en tiempo constante", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  const first = generateOAuthState(now);
  const second = generateOAuthState(now);
  assert.notEqual(first.value, second.value);
  assert.equal(first.hash, hashOAuthState(first.value));
  assert.match(first.hash, /^[0-9a-f]{64}$/u);
  assert.equal(secureStateEquals(first.value, first.value), true);
  assert.equal(secureStateEquals(first.value, second.value), false);
  assert.equal(
    isUsableOAuthState({ consumedAt: null, expiresAt: first.expiresAt, now }),
    true,
  );
  assert.equal(
    isUsableOAuthState({
      consumedAt: "2026-09-16T12:01:00Z",
      expiresAt: first.expiresAt,
      now,
    }),
    false,
  );
  assert.equal(
    isUsableOAuthState({
      consumedAt: null,
      expiresAt: first.expiresAt,
      now: now + 11 * 60 * 1000,
    }),
    false,
  );
});

test("valida identidad corporativa exacta y coincidencia con Supabase", () => {
  assert.equal(
    validateGoogleIdentity({
      googleUserId: "google-1",
      googleEmail: " Usuario@PRO.COM.GT ",
      googleEmailVerified: true,
      supabaseEmail: "usuario@pro.com.gt",
    }).valid,
    true,
  );
  assert.equal(
    validateGoogleIdentity({
      googleUserId: "google-1",
      googleEmail: "usuario@falso-pro.com.gt",
      googleEmailVerified: true,
      supabaseEmail: "usuario@pro.com.gt",
    }).valid,
    false,
  );
  assert.equal(
    validateGoogleIdentity({
      googleUserId: "google-1",
      googleEmail: "otro@pro.com.gt",
      googleEmailVerified: true,
      supabaseEmail: "usuario@pro.com.gt",
    }).valid,
    false,
  );
  assert.equal(
    validateGoogleIdentity({
      googleUserId: "google-1",
      googleEmail: "usuario@pro.com.gt",
      googleEmailVerified: false,
      supabaseEmail: "usuario@pro.com.gt",
    }).valid,
    false,
  );
});

test("valida claims completos del ID token de Google", () => {
  const validClaims = {
    googleSubject: "google-sub-estable",
    googleEmail: " Usuario@PRO.COM.GT ",
    googleEmailVerified: true,
    googleHostedDomain: "PRO.COM.GT",
    issuer: "https://accounts.google.com",
    audience: "gmail-client-id",
    expiresAt: 2_000,
    expectedAudience: "gmail-client-id",
    supabaseEmail: "usuario@pro.com.gt",
    nowSeconds: 1_000,
  };

  assert.deepEqual(validateGoogleIdTokenIdentity(validClaims), {
    valid: true,
    googleUserId: "google-sub-estable",
    email: "usuario@pro.com.gt",
  });
  assert.equal(
    validateGoogleIdTokenIdentity({ ...validClaims, issuer: "https://example.com" })
      .reason,
    "ID_TOKEN_ISSUER_INVALID",
  );
  assert.equal(
    validateGoogleIdTokenIdentity({ ...validClaims, audience: "otro-client" })
      .reason,
    "ID_TOKEN_AUDIENCE_INVALID",
  );
  assert.equal(
    validateGoogleIdTokenIdentity({ ...validClaims, expiresAt: 1_000 }).reason,
    "ID_TOKEN_EXPIRED",
  );
  assert.equal(
    validateGoogleIdTokenIdentity({ ...validClaims, googleSubject: "" }).reason,
    "IDENTITY_MISSING",
  );
  assert.equal(
    validateGoogleIdTokenIdentity({ ...validClaims, googleEmailVerified: false })
      .reason,
    "EMAIL_UNVERIFIED",
  );
  assert.equal(
    validateGoogleIdTokenIdentity({ ...validClaims, googleHostedDomain: "otro.com" })
      .reason,
    "HOSTED_DOMAIN_NOT_ALLOWED",
  );
  assert.equal(
    validateGoogleIdTokenIdentity({
      ...validClaims,
      googleEmail: "otro@pro.com.gt",
    }).reason,
    "EMAIL_MISMATCH",
  );
});

test("exige los scopes Gmail completos y reconoce invalid_grant", () => {
  assert.deepEqual(GMAIL_REQUIRED_SCOPES, [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
  const scopes = normalizeGrantedScopes([
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "scope-adicional-legitimo",
  ]);
  assert.equal(hasAllRequiredGmailScopes(scopes), true);
  assert.equal(scopes.includes("profile"), false);
  assert.equal(
    hasAllRequiredGmailScopes(scopes.filter((scope) => !scope.endsWith("gmail.send"))),
    false,
  );
  assert.equal(
    isInvalidGrant({ response: { data: { error: "invalid_grant" } } }),
    true,
  );
  assert.equal(isInvalidGrant(new Error("invalid_grant")), true);
  assert.equal(isInvalidGrant(new Error("temporarily_unavailable")), false);
});

test("solo conserva un token previo para la misma identidad y correo", () => {
  assert.equal(
    canPreserveStoredRefreshToken({
      hasStoredToken: false,
      storedGoogleUserId: "google-1",
      storedEmail: "usuario@pro.com.gt",
      googleUserId: "google-1",
      email: "usuario@pro.com.gt",
    }),
    false,
  );
  assert.equal(
    canPreserveStoredRefreshToken({
      hasStoredToken: true,
      storedGoogleUserId: "google-1",
      storedEmail: "usuario@pro.com.gt",
      googleUserId: "google-1",
      email: "usuario@pro.com.gt",
    }),
    true,
  );
  assert.equal(
    canPreserveStoredRefreshToken({
      hasStoredToken: true,
      storedGoogleUserId: "google-2",
      storedEmail: "usuario@pro.com.gt",
      googleUserId: "google-1",
      email: "usuario@pro.com.gt",
    }),
    false,
  );
});

test("la reconexión reutiliza el ID persistido y reinicia su ciclo temporal", () => {
  let generatedIds = 0;
  assert.equal(
    resolveGmailConnectionId("conexion-persistida", () => {
      generatedIds += 1;
      return "conexion-generada";
    }),
    "conexion-persistida",
  );
  assert.equal(generatedIds, 0);
  assert.equal(
    resolveGmailConnectionId(null, () => {
      generatedIds += 1;
      return "conexion-generada";
    }),
    "conexion-generada",
  );
  assert.equal(generatedIds, 1);
  assert.deepEqual(
    getGmailReconnectionTemporalFields("2026-09-16T12:00:00.000Z"),
    {
      connected_at: "2026-09-16T12:00:00.000Z",
      last_token_refresh_at: "2026-09-16T12:00:00.000Z",
      last_sync_at: null,
      reauth_required_at: null,
      disconnected_at: null,
    },
  );
});

test("el AAD de reconexión usa exactamente el ID de la fila persistida", () => {
  const persistedId = resolveGmailConnectionId(
    "conexion-persistida",
    () => "conexion-nueva-que-no-debe-usarse",
  );
  const encrypted = encryptRefreshToken({
    refreshToken: "refresh-token-nuevo",
    encryptionKeyBase64: key,
    userId: "usuario-1",
    connectionId: persistedId,
    keyVersion: 1,
  });

  assert.equal(
    decryptRefreshToken({
      ...encrypted,
      encryptionKeyBase64: key,
      userId: "usuario-1",
      connectionId: "conexion-persistida",
      keyVersion: 1,
    }),
    "refresh-token-nuevo",
  );
  assert.throws(() =>
    decryptRefreshToken({
      ...encrypted,
      encryptionKeyBase64: key,
      userId: "usuario-1",
      connectionId: "conexion-nueva-que-no-debe-usarse",
      keyVersion: 1,
    }),
  );
});

test("el indicador representa cada estado Gmail sin depender solo del color", () => {
  const connection = {
    connected: true,
    email: "usuario@pro.com.gt",
    status: "CONNECTED",
    lastSyncAt: null,
  };
  assert.deepEqual(
    getGmailIndicatorPresentation({ kind: "ready", connection }),
    { label: "Conectado", tone: "connected" },
  );
  assert.deepEqual(
    getGmailIndicatorPresentation({
      kind: "ready",
      connection: { ...connection, connected: false, status: "REAUTH_REQUIRED" },
    }),
    { label: "Reconectar Gmail", tone: "reauth" },
  );
  assert.deepEqual(
    getGmailIndicatorPresentation({
      kind: "ready",
      connection: { ...connection, connected: false, status: "DISCONNECTED" },
    }),
    { label: "Conectar Gmail", tone: "disconnected" },
  );
  assert.deepEqual(getGmailIndicatorPresentation({ kind: "loading" }), {
    label: "Consultando estado de Gmail",
    tone: "loading",
  });
  assert.deepEqual(getGmailIndicatorPresentation({ kind: "error" }), {
    label: "Estado no disponible",
    tone: "error",
  });
});

test("rutas y servicio mantienen OAuth Gmail separado, server-only y sanitizado", async () => {
  const [
    connect,
    callback,
    status,
    disconnect,
    service,
    onboarding,
    googleLogin,
    nextConfig,
    onboardingPage,
    googleLogo,
  ] =
    await Promise.all(
      [
        "../src/app/api/integrations/gmail/connect/route.ts",
        "../src/app/api/integrations/gmail/callback/route.ts",
        "../src/app/api/integrations/gmail/status/route.ts",
        "../src/app/api/integrations/gmail/disconnect/route.ts",
        "../src/features/integrations/gmail/service.ts",
        "../src/features/integrations/gmail/components/gmail-onboarding-actions.tsx",
        "../src/features/auth/components/google-sign-in-button.tsx",
        "../next.config.ts",
        "../src/app/integrations/gmail/page.tsx",
        "../src/components/brand/google-logo.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(connect, /getAuthorizedGmailRequestUser/u);
  assert.match(connect, /httpOnly: true/u);
  assert.match(connect, /sameSite: "lax"/u);
  assert.match(callback, /secureStateEquals/u);
  assert.match(callback, /!returnedState/u);
  assert.match(callback, /!cookieState/u);
  assert.match(callback, /consumeGmailOAuthState/u);
  assert.match(callback, /resultRedirect\("state_invalid"\)/u);
  assert.match(callback, /resultRedirect\("session_expired"\)/u);
  assert.match(callback, /maxAge: 0/u);
  assert.match(callback, /SANITIZED_AUTHORIZATION_FAILURES/u);
  assert.match(callback, /GMAIL_AUTHORIZATION_UNEXPECTED/u);
  assert.doesNotMatch(callback, /console\.error\([^\n]*error/iu);
  assert.match(service, /import "server-only"/u);
  assert.match(service, /access_type: "offline"/u);
  assert.match(service, /include_granted_scopes: true/u);
  assert.match(service, /prompt: "consent"/u);
  assert.match(service, /login_hint: user\.email/u);
  assert.match(service, /hd: CORPORATE_EMAIL_DOMAIN/u);
  assert.doesNotMatch(service, /prompt: "select_account"/u);
  assert.match(service, /verifyIdToken/u);
  assert.match(service, /audience: environment\.clientId/u);
  assert.match(service, /getTokenInfo/u);
  assert.match(service, /GMAIL_TOKEN_EXCHANGE_FAILED/u);
  assert.match(service, /GMAIL_ID_TOKEN_VERIFICATION_FAILED/u);
  assert.match(service, /GMAIL_TOKEN_INFO_FAILED/u);
  assert.match(service, /GMAIL_TOKEN_ENCRYPTION_FAILED/u);
  assert.match(service, /GMAIL_REFRESH_TOKEN_REQUIRED/u);
  assert.match(service, /resolveGmailConnectionId\(existing\?\.id, randomUUID\)/u);
  assert.match(service, /GOOGLE_ACCOUNT_MISMATCH/u);
  assert.match(service, /encrypted_refresh_token/u);
  assert.match(service, /revokeToken/u);
  assert.match(service, /REAUTH_REQUIRED/u);
  assert.match(service, /\.is\("consumed_at", null\)/u);
  assert.match(service, /\.gt\("expires_at", now\)/u);
  assert.match(service, /\.insert\(\{/u);
  assert.match(service, /\.update\(\{/u);
  assert.doesNotMatch(service, /\.upsert\(/u);
  assert.match(
    service,
    /\.eq\("id", existing\.id\)[\s\S]*\.eq\("user_id", input\.user\.id\)/u,
  );
  const reconnectUpdate = service.slice(
    service.indexOf('.from("gmail_connections")\n        .update({'),
    service.indexOf('.from("gmail_connections")\n        .insert({'),
  );
  assert.doesNotMatch(reconnectUpdate, /^\s*(?:id|user_id):/gmu);
  assert.match(reconnectUpdate, /getGmailReconnectionTemporalFields\(now\)/u);
  assert.match(service, /connection_store_failed/u);
  assert.match(service, /operation,[\s\S]*code,[\s\S]*constraint/u);
  assert.doesNotMatch(
    service,
    /console\.error\([^)]*(?:payload|tokens|refreshToken|diagnosticText)/su,
  );
  assert.match(disconnect, /hasValidSameOrigin/u);
  assert.doesNotMatch(disconnect, /auth\.signOut/u);
  assert.match(service, /status: "DISCONNECTED"/u);
  assert.match(service, /encrypted_refresh_token: null/u);
  assert.doesNotMatch(status, /refresh|access_token|encrypted|auth_tag|client_secret/iu);
  assert.match(onboarding, /href="\/api\/integrations\/gmail\/connect"/u);
  assert.match(onboarding, /<a[\s\S]*href="\/api\/integrations\/gmail\/connect"/u);
  assert.match(onboarding, /action="\/auth\/signout"/u);
  assert.match(onboarding, /method="post"/u);
  assert.doesNotMatch(onboarding, /useEffect|window\.location/u);
  assert.doesNotMatch(googleLogin, /gmail\.|access_type|prompt:\s*["']consent/iu);
  assert.match(googleLogin, /GoogleLogo/u);
  assert.doesNotMatch(googleLogin, /<svg/u);
  assert.match(onboarding, /GoogleLogo/u);
  assert.match(onboarding, /Conectar con Google/u);
  assert.match(onboarding, /Reconectar con Google/u);
  assert.doesNotMatch(onboarding, /sm:grid-cols-3/u);
  assert.match(onboarding, /min-\[420px\]:grid-cols-2/u);
  assert.match(onboarding, /Continuar a la aplicación/u);
  assert.match(onboarding, /className="w-full gap-2 px-3 leading-tight"/u);
  assert.match(onboardingPage, /max-w-lg/u);
  assert.match(onboardingPage, /min-h-dvh/u);
  assert.match(onboardingPage, /overflow-hidden/u);
  assert.match(
    onboardingPage,
    /message && !mergeConnectedMessage/u,
  );
  assert.match(
    onboardingPage,
    /mergeConnectedMessage \? "Gmail quedó autorizado correctamente\." : "Gmail conectado"/u,
  );
  assert.doesNotMatch(
    onboardingPage,
    /Correos operacionales|Envíos controlados|Tú controlas el permiso/u,
  );
  assert.match(
    onboardingPage,
    /El servidor aplica los filtros y destinatarios autorizados/u,
  );
  assert.match(googleLogo, /aria-hidden="true"/u);
  assert.match(googleLogo, /focusable="false"/u);
  assert.match(googleLogo, /#4285F4/u);
  assert.match(nextConfig, /incomingRequests/u);
  assert.match(nextConfig, /integrations\\\/gmail\\\/callback/u);
});

test("101 reemplaza solo la restricción de scopes y admite scopes adicionales", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/101_gmail_connection_identity_scopes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const replacement = migration.slice(
    migration.indexOf("alter table public.gmail_connections\n  drop constraint"),
  );

  assert.match(migration, /^begin;/mu);
  assert.match(migration, /to_regclass\('public\.gmail_connections'\)/u);
  assert.match(migration, /gmail_connections_scopes_ck/u);
  assert.match(replacement, /drop constraint gmail_connections_scopes_ck/u);
  assert.match(replacement, /add constraint gmail_connections_scopes_ck/u);
  assert.match(replacement, /granted_scopes @> array\[/u);
  assert.match(replacement, /'openid'/u);
  assert.match(replacement, /'email'/u);
  assert.match(replacement, /gmail\.readonly/u);
  assert.match(replacement, /gmail\.send/u);
  assert.doesNotMatch(replacement, /'profile'/u);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/iu);
  assert.match(migration, /commit;\s*$/u);
});

test("la migración limita credenciales a backend y state de un solo uso", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/100_gmail_connections.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table public\.gmail_connections/u);
  assert.match(migration, /create table public\.gmail_oauth_states/u);
  assert.match(migration, /encrypted_refresh_token/u);
  assert.match(migration, /encryption_iv/u);
  assert.match(migration, /encryption_auth_tag/u);
  assert.match(migration, /enable row level security/u);
  assert.match(migration, /force row level security/u);
  assert.match(migration, /revoke all on table public\.gmail_connections[\s\S]*authenticated/u);
  assert.match(migration, /grant select, insert, update, delete[\s\S]*service_role/u);
  assert.match(migration, /state_hash text not null unique/u);
  assert.match(migration, /consumed_at timestamptz/u);
  assert.match(
    migration,
    /created_at <= connected_at[\s\S]*last_token_refresh_at >= connected_at/u,
  );
  assert.doesNotMatch(migration, /^\s*refresh_token\s+text/gmu);
});

test("layouts muestran el estado Gmail sin convertirlo en requisito de acceso", async () => {
  const [
    dashboard,
    platform,
    topbar,
    platformTopbar,
    indicator,
    statusRoute,
    proxy,
    clientActions,
    serverEnvironment,
    cryptoCore,
    signOut,
    connect,
  ] = await Promise.all(
    [
      "../src/app/(dashboard)/layout.tsx",
      "../src/app/platform/layout.tsx",
      "../src/components/layout/topbar.tsx",
      "../src/features/platform/components/platform-topbar.tsx",
      "../src/features/integrations/gmail/components/gmail-connection-indicator.tsx",
      "../src/app/api/integrations/gmail/status/route.ts",
      "../src/lib/supabase/proxy.ts",
      "../src/features/integrations/gmail/components/gmail-onboarding-actions.tsx",
      "../src/features/integrations/gmail/server-environment.ts",
      "../src/features/integrations/gmail/crypto-core.ts",
      "../src/app/auth/signout/route.ts",
      "../src/app/api/integrations/gmail/connect/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.doesNotMatch(dashboard, /getGmailConnectionPublicStatus/u);
  assert.doesNotMatch(dashboard, /redirect\("\/integrations\/gmail"\)/u);
  assert.doesNotMatch(platform, /redirect\("\/integrations\/gmail"\)/u);
  assert.match(topbar, /GmailConnectionIndicator/u);
  assert.match(platformTopbar, /GmailConnectionIndicator/u);
  assert.match(indicator, /^"use client";/u);
  assert.match(indicator, /fetch\("\/api\/integrations\/gmail\/status"/u);
  assert.match(indicator, /cache: "no-store"/u);
  assert.match(indicator, /kind: "loading"/u);
  assert.match(indicator, /kind: "error"/u);
  assert.match(indicator, /href="\/integrations\/gmail"/u);
  assert.match(indicator, /aria-label/u);
  assert.match(indicator, /focus-visible:ring/u);
  assert.match(indicator, /md:w-36/u);
  assert.match(indicator, /GoogleLogo/u);
  assert.doesNotMatch(indicator, /MailCheck|MailWarning|RefreshCcw/u);
  assert.match(indicator, /GMAIL_CONNECTION_CHANGED_EVENT/u);
  assert.doesNotMatch(indicator, /setInterval|setTimeout/u);
  assert.doesNotMatch(
    indicator,
    /gmail_connections|gmail_oauth_states|refresh_token|access_token|ciphertext|auth_tag|google_user_id/iu,
  );
  assert.match(statusRoute, /getGmailConnectionPublicStatus/u);
  assert.match(statusRoute, /private, no-store/u);
  assert.match(statusRoute, /Vary: "Cookie"/u);
  assert.doesNotMatch(
    statusRoute,
    /refresh_token|access_token|ciphertext|auth_tag|google_user_id/iu,
  );
  assert.match(proxy, /"\/api\/integrations\/gmail"/u);
  assert.doesNotMatch(dashboard, /signOut/u);
  assert.doesNotMatch(platform, /signOut/u);
  assert.match(clientActions, /^"use client";/u);
  assert.match(clientActions, /announceGmailConnectionChange/u);
  assert.match(clientActions, /router\.refresh\(\)/u);
  assert.doesNotMatch(clientActions, /service|server-environment|createAdminClient/u);
  assert.match(serverEnvironment, /import "server-only"/u);
  assert.match(cryptoCore, /import "server-only"/u);
  assert.doesNotMatch(signOut, /gmail_connections|disconnectGmail|revokeToken/u);
  assert.match(connect, /getGmailConnectionPublicStatus/u);
  assert.match(connect, /if \(connection\.connected\)/u);
});
