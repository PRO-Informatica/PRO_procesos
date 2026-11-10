import assert from "node:assert/strict";
import test from "node:test";
import { clipboardGuideImages } from "../src/features/vision-ocr/guide-photo-intake.ts";
import { validateGuideSource } from "../src/features/vision-ocr/guide-sources.ts";

test("pegar conserva todas las fotos sin duplicar la representación de items y files", () => {
  const files = [new File(["a"], "whatsapp.png", { type: "image/png" }), new File(["b"], "otra.jpg", { type: "image/jpeg" })];
  assert.deepEqual(clipboardGuideImages({ files, items: files.map((file) => ({ kind: "file", getAsFile: () => file })) }), files);
});

test("el portapapeles puede entregar solo items; el texto y HTML quedan para su campo", () => {
  const image = new File(["a"], "image.png", { type: "image/png" });
  const text = { kind: "string", getAsFile: () => { throw Error("No debe leer texto como archivo"); } };
  assert.deepEqual(clipboardGuideImages({ items: [text, { kind: "file", getAsFile: () => null }, { kind: "file", getAsFile: () => image }] }), [image]);
  assert.deepEqual(clipboardGuideImages({ items: [text] }), []);
  assert.deepEqual(clipboardGuideImages({ files: [new File(["pdf"], "guia.pdf", { type: "application/pdf" })] }), []);
});

test("las fotos pegadas conservan su tipo y tamaño para aplicar los mismos límites de carga", () => {
  const unsupported = new File(["gif"], "foto.gif", { type: "image/gif" });
  const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "foto.png", { type: "image/png" });
  const [gif, png] = clipboardGuideImages({ files: [unsupported, large] });
  assert.match(validateGuideSource(gif, false), /JPG, PNG o WEBP/);
  assert.match(validateGuideSource(png, false), /10 MiB/);
});
