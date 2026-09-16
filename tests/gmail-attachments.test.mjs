import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GmailAttachmentValidationError,
  validateGmailAttachment,
  validateOutgoingGmailAttachments,
} from "../src/features/integrations/gmail/attachment-validation.ts";
import {
  GMAIL_MAX_ATTACHMENT_COUNT,
  GMAIL_MAX_TOTAL_ATTACHMENT_BYTES,
} from "../src/features/integrations/gmail/attachment-constants.ts";
import {
  buildPlainTextMime,
  decodeBase64Url,
  encodeBase64Url,
  extractAttachmentSummaries,
  findGmailAttachmentPart,
  hashSendContent,
  mapGmailMessage,
} from "../src/features/integrations/gmail/mailbox-mime.ts";

const PDF = Buffer.from("%PDF-1.7\ncontenido\n%%EOF", "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

test("base64URL rechaza datos malformados y conserva bytes válidos", () => {
  assert.deepEqual(decodeBase64Url(encodeBase64Url(PDF)), PDF);
  assert.throws(() => decodeBase64Url("abc%2Fdef"), /BASE64URL_INVALID/u);
  assert.throws(() => decodeBase64Url("a"), /BASE64URL_INVALID/u);
});

test("encuentra recursivamente adjuntos externos e inline", () => {
  const longId = `opaque_${"A-b_9".repeat(100)}`;
  const payload = {
    mimeType: "multipart/mixed",
    parts: [{
      mimeType: "multipart/alternative",
      parts: [
        { partId: "1.1", filename: "foto.png", mimeType: "image/png", body: { data: encodeBase64Url(PNG), size: PNG.length } },
        { partId: "1.2", filename: "factura.pdf", mimeType: "application/pdf", body: { attachmentId: longId, size: PDF.length } },
      ],
    }],
  };
  const summaries = extractAttachmentSummaries("mensaje_1", payload);
  const inline = summaries.find((item) => item.fileName === "foto.png");
  assert.ok(inline);
  assert.equal(findGmailAttachmentPart("mensaje_1", payload, inline.id).external, false);
  assert.equal(findGmailAttachmentPart("mensaje_1", payload, inline.id).data, encodeBase64Url(PNG));
  assert.equal(findGmailAttachmentPart("mensaje_1", payload, longId).external, true);
  assert.equal(findGmailAttachmentPart("mensaje_1", payload, "ajeno"), null);
});

test("mensajes recibidos y enviados muestran adjuntos obtenidos del MIME real", () => {
  const attachmentPart = {
    filename: "factura.pdf",
    mimeType: "application/pdf",
    body: { attachmentId: "opaque_attachment", size: PDF.length },
  };
  const base = {
    id: "mensaje",
    threadId: "hilo",
    internalDate: "1",
    payload: { parts: [attachmentPart] },
  };
  const received = mapGmailMessage({
    ...base,
    labelIds: ["INBOX"],
    payload: { ...base.payload, headers: [
      { name: "From", value: "permitido@example.com" },
      { name: "To", value: "usuario@pro.com.gt" },
    ] },
  }, ["permitido@example.com"]);
  const sent = mapGmailMessage({
    ...base,
    labelIds: ["SENT"],
    payload: { ...base.payload, headers: [
      { name: "From", value: "usuario@pro.com.gt" },
      { name: "To", value: "permitido@example.com" },
    ] },
  }, ["permitido@example.com"]);
  assert.equal(received.direction, "RECEIVED");
  assert.equal(sent.direction, "SENT");
  assert.equal(received.attachments[0].fileName, "factura.pdf");
  assert.equal(sent.attachments[0].fileName, "factura.pdf");
});

test("valida extensión, MIME, magic bytes, nombre y tamaño", async () => {
  const valid = await validateGmailAttachment({
    fileName: "factura.pdf",
    mimeType: "application/pdf",
    bytes: PDF,
    maxBytes: 1024,
  });
  assert.equal(valid.previewable, true);
  assert.match(valid.sha256, /^[0-9a-f]{64}$/u);
  await assert.rejects(
    validateGmailAttachment({ fileName: "factura.png", mimeType: "image/png", bytes: PDF, maxBytes: 1024 }),
    (error) => error instanceof GmailAttachmentValidationError && error.code === "ATTACHMENT_SIGNATURE_INVALID" && error.httpStatus === 415,
  );
  await assert.rejects(
    validateGmailAttachment({ fileName: "factura.pdf", mimeType: "image/png", bytes: PNG, maxBytes: 1024 }),
    (error) => error instanceof GmailAttachmentValidationError && error.code === "ATTACHMENT_TYPE_NOT_ALLOWED",
  );
  await assert.rejects(
    validateGmailAttachment({ fileName: "../factura.pdf", mimeType: "application/pdf", bytes: PDF, maxBytes: 1024 }),
    (error) => error instanceof GmailAttachmentValidationError && error.code === "ATTACHMENT_NAME_INVALID",
  );
  await assert.rejects(
    validateGmailAttachment({ fileName: "factura\r\nBcc: x@y.com.pdf", mimeType: "application/pdf", bytes: PDF, maxBytes: 1024 }),
    (error) => error instanceof GmailAttachmentValidationError && error.code === "ATTACHMENT_NAME_INVALID",
  );
  await assert.rejects(
    validateGmailAttachment({ fileName: "factura.pdf", mimeType: "application/pdf", bytes: PDF, maxBytes: 2 }),
    (error) => error instanceof GmailAttachmentValidationError && error.code === "ATTACHMENT_TOO_LARGE" && error.httpStatus === 413,
  );
});

test("rechaza formatos no permitidos, CSV binario y hojas con macros", async () => {
  await assert.rejects(
    validateGmailAttachment({ fileName: "script.js", mimeType: "text/javascript", bytes: Buffer.from("alert(1)"), maxBytes: 1024 }),
    (error) => error.code === "ATTACHMENT_TYPE_NOT_ALLOWED",
  );
  await assert.rejects(
    validateGmailAttachment({ fileName: "datos.csv", mimeType: "text/csv", bytes: Buffer.from([0, 1, 2]), maxBytes: 1024 }),
    (error) => error.code === "ATTACHMENT_SIGNATURE_INVALID",
  );
  const macroXls = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from("_VBA_PROJECT"),
  ]);
  await assert.rejects(
    validateGmailAttachment({ fileName: "macro.xls", mimeType: "application/vnd.ms-excel", bytes: macroXls, maxBytes: 1024 }),
    (error) => error.code === "ATTACHMENT_SIGNATURE_INVALID",
  );
});

test("aplica cantidad, tamaño individual y total a archivos salientes", async () => {
  const files = Array.from({ length: GMAIL_MAX_ATTACHMENT_COUNT + 1 }, (_, index) =>
    new File([PDF], `f${index}.pdf`, { type: "application/pdf" }));
  await assert.rejects(
    validateOutgoingGmailAttachments(files, 1024),
    (error) => error.code === "ATTACHMENT_COUNT_EXCEEDED" && error.httpStatus === 413,
  );
  const oversized = new File([Buffer.alloc(1025, 1)], "foto.png", { type: "image/png" });
  await assert.rejects(
    validateOutgoingGmailAttachments([oversized], 1024),
    (error) => error.code === "ATTACHMENT_TOO_LARGE",
  );
  assert.equal(GMAIL_MAX_TOTAL_ATTACHMENT_BYTES, 15 * 1024 * 1024);
});

test("construye multipart/mixed RFC con varios adjuntos y headers de respuesta", async () => {
  const first = await validateGmailAttachment({ fileName: "factura.pdf", mimeType: "application/pdf", bytes: PDF, maxBytes: 1024 });
  const second = await validateGmailAttachment({ fileName: "foto.png", mimeType: "image/png", bytes: PNG, maxBytes: 1024 });
  const raw = buildPlainTextMime({
    from: "usuario@pro.com.gt",
    to: "facturas@pro.com.gt",
    subject: "Re: Pedido",
    body: "Respuesta segura",
    inReplyTo: "<mensaje@example>",
    references: "<original@example> <mensaje@example>",
    attachments: [first, second],
    boundary: "pro_boundary_test_1234567890",
  });
  const decoded = decodeBase64Url(raw).toString("utf8");
  assert.match(decoded, /Content-Type: multipart\/mixed; boundary="pro_boundary_test_1234567890"/u);
  assert.match(decoded, /In-Reply-To: <mensaje@example>/u);
  assert.match(decoded, /References: <original@example> <mensaje@example>/u);
  assert.equal((decoded.match(/Content-Disposition: attachment/gu) ?? []).length, 2);
  assert.match(decoded, /--pro_boundary_test_1234567890--\r\n$/u);
});

test("idempotencia incluye el hash de bytes de cada adjunto", async () => {
  const first = await validateGmailAttachment({ fileName: "factura.pdf", mimeType: "application/pdf", bytes: PDF, maxBytes: 1024 });
  const changed = await validateGmailAttachment({ fileName: "factura.pdf", mimeType: "application/pdf", bytes: Buffer.concat([PDF, Buffer.from("x")]), maxBytes: 1024 });
  const base = { recipient: "facturas@pro.com.gt", subject: "Pedido", body: "Texto", threadId: null };
  assert.notEqual(hashSendContent({ ...base, attachments: [first] }), hashSendContent({ ...base, attachments: [changed] }));
});

test("rutas no decodifican dos veces, conservan auth y mapean errores", async () => {
  const [route, service, send, reply] = await Promise.all([
    readFile(new URL("../src/app/api/integrations/gmail/attachments/[messageId]/[attachmentId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/integrations/gmail/mailbox-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/integrations/gmail/send/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/integrations/gmail/reply/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(route, /decodeURIComponent/u);
  assert.match(service, /isSafeGmailAttachmentId\(input\.attachmentId\)/u);
  assert.match(service, /findGmailAttachmentPart/u);
  assert.match(service, /getAuthorizedGmailClient\(user\.id\)/u);
  assert.match(service, /ATTACHMENT_UNAVAILABLE", 404/u);
  assert.match(service, /ATTACHMENT_TOO_LARGE", 413/u);
  assert.match(service, /error\.httpStatus/u);
  assert.match(send, /hasValidSameOrigin/u);
  assert.match(reply, /hasValidSameOrigin/u);
  assert.match(send, /readLimitedMultipartFormData/u);
  assert.match(reply, /readLimitedMultipartFormData/u);
});

test("UI prepara, previsualiza, elimina y libera object URLs", async () => {
  const [picker, workspace] = await Promise.all([
    readFile(new URL("../src/features/integrations/gmail/components/gmail-attachment-picker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/integrations/gmail/components/gmail-mailbox-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(picker, /URL\.createObjectURL/u);
  assert.match(picker, /URL\.revokeObjectURL/u);
  assert.match(picker, /Preparando adjuntos/u);
  assert.match(picker, /onDrop/u);
  assert.match(picker, /Eliminar \$\{attachment\.file\.name\}/u);
  assert.match(workspace, /new FormData\(\)/u);
  assert.match(workspace, /appendAttachments/u);
  assert.match(workspace, /Enviando…/u);
  assert.match(workspace, /MessageAttachments/u);
  assert.match(workspace, /sm:flex-row/u);
  assert.doesNotMatch(workspace, /Content-Type": "multipart\/form-data"/u);
});

test("flujo general no importa ni invoca el pipeline de programaciones", async () => {
  const files = await Promise.all([
    "../src/features/integrations/gmail/mailbox-service.ts",
    "../src/features/integrations/gmail/attachment-validation.ts",
    "../src/features/integrations/gmail/components/gmail-attachment-picker.tsx",
    "../src/features/integrations/gmail/components/gmail-mailbox-workspace.tsx",
    "../src/app/api/integrations/gmail/send/route.ts",
    "../src/app/api/integrations/gmail/reply/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /classifyUniversalInvoice|createProgramming|programming\/|pipeline|storage\.from|createBatch|createDispatch/iu);
});

test("bundle cliente permanece libre de tokens, googleapis y validación binaria server-side", async () => {
  const files = await Promise.all([
    "../src/features/integrations/gmail/components/gmail-attachment-picker.tsx",
    "../src/features/integrations/gmail/components/gmail-mailbox-workspace.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /googleapis|createAdminClient|refresh_token|access_token|client_secret|JSZip|node:crypto/iu);
});
