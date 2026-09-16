import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildTrustedUrl,
  getAuthErrorMessage,
  hasAuthorizedApplicationAccess,
  hasExactCorporateDomain,
  isVerifiedCorporateIdentity,
  normalizeEmail,
  safeInternalPath,
} from "../src/features/auth/security.ts";

test("construye el callback desde la base confiable y conserva rutas internas", () => {
  const callback = buildTrustedUrl(
    "http://localhost:3000",
    "/auth/callback?next=%2Freports",
  );
  assert.equal(callback.origin, "http://localhost:3000");
  assert.equal(callback.pathname, "/auth/callback");
  assert.equal(callback.searchParams.get("next"), "/reports");
  assert.equal(safeInternalPath("/reports?tab=all#top"), "/reports?tab=all#top");
});

test("rechaza URLs externas, protocol-relative, protocolos y separadores ambiguos", () => {
  for (const unsafe of [
    "https://externo.example/reports",
    "//externo.example/reports",
    "javascript:alert(1)",
    "/\\externo.example/reports",
  ]) {
    assert.equal(safeInternalPath(unsafe), "/");
  }
});

test("normaliza correo y valida únicamente el dominio corporativo exacto", () => {
  assert.equal(normalizeEmail("  Usuario@PRO.COM.GT "), "usuario@pro.com.gt");
  assert.equal(hasExactCorporateDomain("usuario@pro.com.gt"), true);
  assert.equal(hasExactCorporateDomain("usuario@falso-pro.com.gt"), false);
  assert.equal(hasExactCorporateDomain("usuario@pro.com.gt.ejemplo.com"), false);
  assert.equal(hasExactCorporateDomain("usuario@@pro.com.gt"), false);
});

test("rechaza un correo corporativo no verificado", () => {
  assert.equal(
    isVerifiedCorporateIdentity({
      email: "usuario@pro.com.gt",
      emailConfirmedAt: null,
    }),
    false,
  );
  assert.equal(
    isVerifiedCorporateIdentity({
      email: "usuario@pro.com.gt",
      emailConfirmedAt: "2026-09-16T12:00:00Z",
    }),
    true,
  );
});

test("deniega perfil ausente/inactivo y exige rol activo o administración de plataforma", () => {
  const activeRole = [{ project: { status: "ACTIVE" }, roleCodes: ["RESIDENT"] }];
  assert.equal(
    hasAuthorizedApplicationAccess({
      profileActive: false,
      isPlatformAdmin: false,
      projectScopes: activeRole,
    }),
    false,
  );
  assert.equal(
    hasAuthorizedApplicationAccess({
      profileActive: true,
      isPlatformAdmin: false,
      projectScopes: [],
    }),
    false,
  );
  assert.equal(
    hasAuthorizedApplicationAccess({
      profileActive: true,
      isPlatformAdmin: false,
      projectScopes: [{ project: { status: "ACTIVE" }, roleCodes: [] }],
    }),
    false,
  );
  assert.equal(
    hasAuthorizedApplicationAccess({
      profileActive: true,
      isPlatformAdmin: false,
      projectScopes: activeRole,
    }),
    true,
  );
  assert.equal(
    hasAuthorizedApplicationAccess({
      profileActive: true,
      isPlatformAdmin: true,
      projectScopes: [],
    }),
    true,
  );
});

test("los errores OAuth se traducen a mensajes sanitizados", () => {
  assert.equal(getAuthErrorMessage("codigo_desconocido"), null);
  assert.match(getAuthErrorMessage("oauth_cancelled"), /canceló/u);
  assert.doesNotMatch(getAuthErrorMessage("access_denied"), /@|uuid|token|code=/iu);
});

test("el flujo implementado usa PKCE/SSR existente, conserva contraseña y no solicita Gmail", async () => {
  const [button, callback, loginAction, proxy, browserClient, serverClient] =
    await Promise.all(
      [
        "../src/features/auth/components/google-sign-in-button.tsx",
        "../src/app/auth/callback/route.ts",
        "../src/features/auth/actions.ts",
        "../src/lib/supabase/proxy.ts",
        "../src/lib/supabase/client.ts",
        "../src/lib/supabase/server.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.match(button, /createClient/u);
  assert.match(button, /signInWithOAuth/u);
  assert.match(button, /provider: "google"/u);
  assert.match(button, /GOOGLE_IDENTITY_SCOPES/u);
  assert.match(button, /queryParams: \{ hd: "pro\.com\.gt" \}/u);
  assert.match(button, /pendingRef\.current/u);
  assert.doesNotMatch(button, /gmail\.|access_type|provider_refresh_token|prompt:\s*["']consent/iu);

  assert.match(callback, /exchangeCodeForSession\(code\)/u);
  assert.match(callback, /supabase\.auth\.getUser\(\)/u);
  assert.match(callback, /validateApplicationAccess\(user\.id\)/u);
  assert.match(callback, /supabase\.auth\.signOut\(\)/u);
  assert.doesNotMatch(callback, /service_role|request\.headers|request\.url/iu);
  assert.match(proxy, /"\/auth\/callback"/u);
  assert.match(loginAction, /signInWithPassword/u);
  assert.match(browserClient, /createBrowserClient/u);
  assert.match(serverClient, /createServerClient/u);
});
