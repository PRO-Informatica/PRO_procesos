import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operationalTopbar = await readFile(
  new URL("../src/components/layout/topbar.tsx", import.meta.url),
  "utf8",
);
const platformTopbar = await readFile(
  new URL("../src/features/platform/components/platform-topbar.tsx", import.meta.url),
  "utf8",
);
const signOutRoute = await readFile(
  new URL("../src/app/auth/signout/route.ts", import.meta.url),
  "utf8",
);

test("las topbars cierran sesión sin depender de identificadores de Server Actions", () => {
  for (const topbar of [operationalTopbar, platformTopbar]) {
    assert.match(topbar, /<a[\s\S]*?href="\/auth\/signout"/u);
    assert.doesNotMatch(topbar, /<form[\s\S]*?\/auth\/signout/u);
    assert.doesNotMatch(topbar, /action=\{signOut\}/u);
  }
});

test("el endpoint de cierre de sesión admite POST y conserva el flujo GET vigente", () => {
  assert.match(signOutRoute, /export async function POST/u);
  assert.match(signOutRoute, /export async function GET/u);
  assert.match(signOutRoute, /await supabase\.auth\.signOut\(\)/u);
  assert.match(signOutRoute, /NextResponse\.redirect\(loginUrl\)/u);
});
