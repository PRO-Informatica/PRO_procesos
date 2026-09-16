import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getSupabaseEnvironmentIdentity,
  resolvePublicEnvironment,
} from "../src/lib/env.ts";

const DEV_REF = "gholwtklihaphoevosyb";
const PROD_REF = "jeyjblxfqqlypxiaznad";
const dev = {
  NEXT_PUBLIC_APP_ENV: "DEV",
  NEXT_PUBLIC_SUPABASE_DEV_URL: `https://${DEV_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY: "dev-public-key",
};
const prod = {
  NEXT_PUBLIC_APP_ENV: "PROD",
  NEXT_PUBLIC_SUPABASE_PROD_URL: `https://${PROD_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PROD_PUBLISHABLE_KEY: "prod-public-key",
};

test("DEV selecciona únicamente la configuración DEV", () => {
  const result = resolvePublicEnvironment(dev);
  assert.equal(result.appEnvironment, "DEV");
  assert.equal(result.projectRef, DEV_REF);
  assert.equal(result.supabasePublishableKey, "dev-public-key");
});

test("PROD selecciona únicamente la configuración PROD", () => {
  const result = resolvePublicEnvironment(prod);
  assert.equal(result.appEnvironment, "PROD");
  assert.equal(result.projectRef, PROD_REF);
  assert.equal(result.supabasePublishableKey, "prod-public-key");
});

test("un ambiente ausente o desconocido falla sin fallback", () => {
  assert.throws(() => resolvePublicEnvironment({}), /DEV o PROD/u);
  assert.throws(
    () => resolvePublicEnvironment({ ...dev, NEXT_PUBLIC_APP_ENV: "STAGING" }),
    /DEV o PROD/u,
  );
});

test("solo son obligatorias las variables del ambiente seleccionado", () => {
  assert.doesNotThrow(() => resolvePublicEnvironment(dev));
  assert.doesNotThrow(() => resolvePublicEnvironment(prod));
  assert.throws(
    () => resolvePublicEnvironment({ NEXT_PUBLIC_APP_ENV: "DEV" }),
    /NEXT_PUBLIC_SUPABASE_DEV_URL/u,
  );
  assert.throws(
    () =>
      resolvePublicEnvironment({
        NEXT_PUBLIC_APP_ENV: "DEV",
        NEXT_PUBLIC_SUPABASE_DEV_URL: dev.NEXT_PUBLIC_SUPABASE_DEV_URL,
      }),
    /NEXT_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY/u,
  );
});

test("rechaza referencias cruzadas entre DEV y PROD", () => {
  assert.throws(
    () =>
      resolvePublicEnvironment({
        ...dev,
        NEXT_PUBLIC_SUPABASE_DEV_URL: `https://${PROD_REF}.supabase.co`,
      }),
    /no corresponde/u,
  );
  assert.throws(
    () =>
      resolvePublicEnvironment({
        ...prod,
        NEXT_PUBLIC_SUPABASE_PROD_URL: `https://${DEV_REF}.supabase.co`,
      }),
    /no corresponde/u,
  );
});

test("exige HTTPS y el host exacto de Supabase", () => {
  for (const url of [
    `http://${DEV_REF}.supabase.co`,
    `https://${DEV_REF}.supabase.co.ejemplo.com`,
  ]) {
    assert.throws(
      () =>
        resolvePublicEnvironment({
          ...dev,
          NEXT_PUBLIC_SUPABASE_DEV_URL: url,
        }),
      /Supabase/u,
    );
  }
});

test("la identidad pública oculta el project ref y nunca incluye claves", () => {
  assert.deepEqual(
    getSupabaseEnvironmentIdentity(resolvePublicEnvironment(dev)),
    { environment: "DEV", projectRef: "ghol…osyb" },
  );
});

test("service_role permanece fuera del código importable por cliente", async () => {
  const clientFiles = await Promise.all(
    [
      "../src/lib/env.ts",
      "../src/lib/supabase/client.ts",
      "../src/components/shared/environment-badge.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  for (const contents of clientFiles) {
    assert.doesNotMatch(contents, /SERVICE_ROLE/u);
    assert.doesNotMatch(contents, /server-environment/u);
  }

  const serverEnvironment = await readFile(
    new URL("../src/lib/supabase/server-environment.ts", import.meta.url),
    "utf8",
  );
  assert.match(serverEnvironment, /^import "server-only";/u);
  assert.match(serverEnvironment, /SUPABASE_DEV_SERVICE_ROLE_KEY/u);
  assert.match(serverEnvironment, /SUPABASE_PROD_SERVICE_ROLE_KEY/u);
});

test("los clientes Supabase consumen la configuración centralizada", async () => {
  const files = await Promise.all(
    ["client.ts", "server.ts", "proxy.ts"].map((name) =>
      readFile(
        new URL(`../src/lib/supabase/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );

  for (const contents of files) {
    assert.match(contents, /getPublicEnvironment/u);
    assert.match(contents, /environment\.supabaseUrl/u);
    assert.match(contents, /environment\.supabasePublishableKey/u);
    assert.doesNotMatch(contents, /NEXT_PUBLIC_SUPABASE_URL/u);
  }
});
