import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as vision from "../src/features/vision-ocr/vision-ocr.ts";

const source = await readFile(new URL("../src/features/vision-ocr/service.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(env) {
  const exports = {}, calls = [];
  const imports = { "server-only": {}, "./vision-ocr": vision,
    "./document-parser": { detectVisionTemplate: () => "DISPATCH_GUIDE", parseVisionDocument: () => ({ warnings: [] }) },
    "./complete-guide-parser": { guideReadingTurns: () => 0 }, "./control-guide-parser": { parseGuideVariants: () => ({ DISPATCH_GUIDE: {} }) } };
  runInNewContext(compiled, { exports, process: { env }, Buffer, AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ responses: [{ fullTextAnnotation: { text: "PRO" } }] }); },
    require: (name) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, read: () => exports.extractDocumentText(new File([new Uint8Array([137,80,78,71,13,10,26,10,0])], "qa.png", { type: "image/png" }), "DISPATCH_GUIDE", null) };
}

test("DEV y PROD usan únicamente su clave OCR de servidor", async () => {
  for (const environment of ["DEV", "PROD"]) {
    const f = fixture({ NEXT_PUBLIC_APP_ENV: environment, GOOGLE_VISION_API_DEV_KEY: "synthetic-dev-key", GOOGLE_VISION_API_PROD_KEY: "synthetic-prod-key" });
    await f.read();
    assert.equal(f.calls[0].options.headers["x-goog-api-key"], environment === "PROD" ? "synthetic-prod-key" : "synthetic-dev-key");
    assert.equal(f.calls[0].url, vision.VISION_OCR_ENDPOINT);
    assert.ok(!f.calls[0].url.includes("key="));
  }
});

test("PROD sin clave propia no utiliza la clave de DEV ni envía una petición", async () => {
  const f = fixture({ NEXT_PUBLIC_APP_ENV: "PROD", GOOGLE_VISION_API_DEV_KEY: "synthetic-dev-key" });
  await assert.rejects(f.read(), (error) => error.reason === "API_KEY_NOT_CONFIGURED" && /no está configurado/.test(error.publicMessage));
  assert.equal(f.calls.length, 0);
});
