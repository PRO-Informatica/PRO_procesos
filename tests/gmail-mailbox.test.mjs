import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canUseGmailModule } from "../src/features/integrations/gmail/access-policy.ts";
import {
  buildGmailMailboxQuery,
  classifyGmailReadRetry,
  extractHeaderEmails,
  getBackoffDelayMs,
  isAllowedConversationMessage,
  isAllowedIncomingMessage,
  isAllowedSentMessage,
  isSafeGmailId,
  isSafeGmailAttachmentId,
  isSafeGmailPageToken,
  normalizeMailboxEmailList,
  validateComposeInput,
} from "../src/features/integrations/gmail/mailbox-policy.ts";
import {
  buildPlainTextMime,
  buildReplyReferences,
  decodeBase64Url,
  decodeRfc2047Header,
  encodeBase64Url,
  extractAttachmentSummaries,
  extractSafeMessageBody,
  hashSendContent,
  htmlToSafeText,
  sanitizeAttachmentFileName,
} from "../src/features/integrations/gmail/mailbox-mime.ts";

const allowedSenders = ["respuesta@mixtolisto.example"];
const allowedRecipients = ["facturas@pro.com.gt", "compras@pro.com.gt"];

test("PLATFORM_ADMIN activo obtiene acceso Gmail sin permisos de proyecto", () => {
  assert.equal(canUseGmailModule({
    isPlatformAdmin: true,
    projectStatus: "INACTIVE",
    permissions: [],
    permission: "gmail.mailbox.view",
  }), true);
  assert.equal(canUseGmailModule({
    isPlatformAdmin: true,
    projectStatus: null,
    permissions: [],
    permission: "gmail.mail.send",
  }), true);
});

test("usuarios normales requieren proyecto activo y el permiso Gmail exacto", () => {
  assert.equal(canUseGmailModule({
    isPlatformAdmin: false,
    projectStatus: "ACTIVE",
    permissions: ["gmail.mailbox.view"],
    permission: "gmail.mailbox.view",
  }), true);
  assert.equal(canUseGmailModule({
    isPlatformAdmin: false,
    projectStatus: "INACTIVE",
    permissions: ["gmail.mailbox.view"],
    permission: "gmail.mailbox.view",
  }), false);
  assert.equal(canUseGmailModule({
    isPlatformAdmin: false,
    projectStatus: "ACTIVE",
    permissions: ["dispatch.view"],
    permission: "gmail.mailbox.view",
  }), false);
});

function message({ labels, from, to, payload, id = "m_1", threadId = "t_1" }) {
  return {
    id,
    threadId,
    labelIds: labels,
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: "Prueba" },
      ],
      ...payload,
    },
  };
}

test("normaliza, valida y deduplica listas por ambiente", () => {
  assert.deepEqual(
    normalizeMailboxEmailList([
      " FACTURAS@PRO.COM.GT ",
      "facturas@pro.com.gt",
      "invalido",
      "compras@pro.com.gt",
    ]),
    ["compras@pro.com.gt", "facturas@pro.com.gt"],
  );
});

test("filtra recibidos exactamente por INBOX, remitente, spam y papelera", () => {
  const valid = message({
    labels: ["INBOX"],
    from: "Mixto Listo <RESPUESTA@mixtolisto.example>",
    to: "usuario@pro.com.gt",
  });
  assert.equal(isAllowedIncomingMessage(valid, allowedSenders), true);
  assert.equal(isAllowedIncomingMessage({ ...valid, labelIds: ["INBOX", "SPAM"] }, allowedSenders), false);
  assert.equal(isAllowedIncomingMessage({ ...valid, labelIds: ["TRASH"] }, allowedSenders), false);
  assert.equal(
    isAllowedIncomingMessage(message({ labels: ["INBOX"], from: "alias@mixtolisto.example", to: "usuario@pro.com.gt" }), allowedSenders),
    false,
  );
});

test("filtra enviados por SENT y al menos un destinatario permitido", () => {
  const valid = message({
    labels: ["SENT"],
    from: "usuario@pro.com.gt",
    to: "Otro <otro@example.com>, Facturas <FACTURAS@PRO.COM.GT>",
  });
  assert.equal(isAllowedSentMessage(valid, allowedRecipients), true);
  assert.equal(isAllowedSentMessage({ ...valid, labelIds: ["SENT", "TRASH"] }, allowedRecipients), false);
  assert.equal(isAllowedSentMessage(message({ labels: ["SENT"], from: "usuario@pro.com.gt", to: "otro@example.com" }), allowedRecipients), false);
});

test("un thread solo expone mensajes que pasan el postfiltro individual", () => {
  const incoming = message({ labels: ["INBOX"], from: allowedSenders[0], to: "usuario@pro.com.gt" });
  const sent = message({ labels: ["SENT"], from: "usuario@pro.com.gt", to: allowedRecipients[0] });
  const unrelated = message({ labels: ["INBOX"], from: "ajeno@example.com", to: "usuario@pro.com.gt" });
  assert.equal(isAllowedConversationMessage(incoming, allowedSenders, allowedRecipients), true);
  assert.equal(isAllowedConversationMessage(sent, allowedSenders, allowedRecipients), true);
  assert.equal(isAllowedConversationMessage(unrelated, allowedSenders, allowedRecipients), false);
});

test("la consulta Gmail es restrictiva pero no reemplaza el postfiltro", () => {
  assert.equal(
    buildGmailMailboxQuery("INBOX", allowedSenders),
    "(from:respuesta@mixtolisto.example) -in:trash -in:spam",
  );
  assert.match(buildGmailMailboxQuery("SENT", allowedRecipients), /to:compras@pro\.com\.gt OR to:facturas@pro\.com\.gt/u);
  assert.equal(buildGmailMailboxQuery("INBOX", []), null);
});

test("valida IDs y tokens de paginación antes de enviarlos a Gmail", () => {
  assert.equal(isSafeGmailId("18fAb_9-x"), true);
  assert.equal(isSafeGmailId("../secreto"), false);
  assert.equal(isSafeGmailPageToken("token_de-pagina"), true);
  assert.equal(isSafeGmailPageToken("https://externo.example"), false);
});

test("acepta attachmentId opaco Base64URL largo sin relajar IDs de mensajes", () => {
  const opaqueAttachmentId = `a_${"Ab9-_".repeat(140)}`;
  assert.ok(opaqueAttachmentId.length > 256);
  assert.equal(isSafeGmailAttachmentId(opaqueAttachmentId), true);
  assert.equal(isSafeGmailId(opaqueAttachmentId), false);
  assert.equal(isSafeGmailAttachmentId("../adjunto"), false);
  assert.equal(isSafeGmailAttachmentId("adjunto%252Fdoble"), false);
});

test("extrae direcciones sin confiar en nombres visibles", () => {
  assert.deepEqual(
    extractHeaderEmails('"Compras, PRO" <COMPRAS@PRO.COM.GT>, otro@example.com'),
    ["compras@pro.com.gt", "otro@example.com"],
  );
});

test("decodifica base64URL y MIME multipart anidado prefiriendo texto plano", () => {
  const plain = "Contenido seguro";
  const payload = {
    mimeType: "multipart/mixed",
    parts: [{
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: encodeBase64Url("<b>HTML</b>") } },
        { mimeType: "text/plain", body: { data: encodeBase64Url(plain) }, headers: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }] },
      ],
    }],
  };
  assert.equal(extractSafeMessageBody(payload), plain);
  assert.equal(decodeBase64Url(encodeBase64Url("áéí")).toString("utf8"), "áéí");
});

test("convierte HTML a texto y bloquea scripts, iframes, formularios e imágenes remotas", () => {
  const result = htmlToSafeText('<script>alert(1)</script><p>Hola &amp; equipo</p><img src="https://tracker.example/pixel"><iframe src="x">x</iframe><form>dato</form>');
  assert.equal(result, "Hola & equipo");
  assert.doesNotMatch(result, /script|iframe|form|tracker|https:/iu);
});

test("decodifica headers RFC 2047 y sanea nombres contra path traversal", () => {
  assert.equal(decodeRfc2047Header("=?UTF-8?B?RmFjdHVyYWNpw7Nu?="), "Facturación");
  assert.equal(sanitizeAttachmentFileName("../../Factura.xlsx"), "._._Factura.xlsx");
});

test("extrae metadatos de adjuntos externos e inline en MIME anidado", () => {
  const attachments = extractAttachmentSummaries("mensaje", {
    mimeType: "multipart/mixed",
    parts: [
      { filename: "Factura.pdf", mimeType: "application/pdf", body: { attachmentId: "adjunto_1", size: 320 } },
      { mimeType: "multipart/alternative", parts: [
        { filename: "imagen.png", mimeType: "image/png", partId: "2.1", body: { data: encodeBase64Url("imagen"), size: 6 } },
      ] },
    ],
  });
  assert.equal(attachments.length, 2);
  assert.deepEqual(attachments.find((item) => item.id === "adjunto_1"), {
    id: "adjunto_1",
    messageId: "mensaje",
    fileName: "Factura.pdf",
    mimeType: "application/pdf",
    size: 320,
    previewable: true,
  });
  assert.match(attachments.find((item) => item.fileName === "imagen.png").id, /^inline_[A-Za-z0-9_-]+$/u);
});

test("construye MIME texto plano RFC con base64URL e impide CRLF", () => {
  const raw = buildPlainTextMime({
    from: "usuario@pro.com.gt",
    to: "facturas@pro.com.gt",
    subject: "Envío de prueba",
    body: "Hola\nEquipo",
  });
  const decoded = decodeBase64Url(raw).toString("utf8");
  assert.match(decoded, /MIME-Version: 1\.0\r\n/u);
  assert.match(decoded, /Content-Transfer-Encoding: base64/u);
  assert.doesNotMatch(decoded, /Hola\nEquipo/u);
  assert.throws(() => buildPlainTextMime({ from: "usuario@pro.com.gt", to: "facturas@pro.com.gt\r\nBcc: atacante@example.com", subject: "Prueba", body: "hola" }));
});

test("respuesta conserva In-Reply-To, References y thread controlado en servidor", () => {
  assert.equal(buildReplyReferences("<original@example>", "<respuesta@example>"), "<original@example> <respuesta@example>");
  assert.throws(() => buildReplyReferences(null, "<id>\r\nBcc: atacante@example.com"));
});

test("el compositor solo acepta destinatarios de la lista y una clave idempotente", () => {
  const valid = validateComposeInput({
    recipient: " FACTURAS@PRO.COM.GT ",
    subject: "Factura semanal",
    body: "Adjunto no incluido en esta fase.",
    idempotencyKey: "b7c1848c-a003-4b46-a8dd-5a435b7f8d60",
  }, allowedRecipients);
  assert.equal(valid.valid, true);
  assert.equal(validateComposeInput({ recipient: "otro@example.com", subject: "Hola", body: "Texto", idempotencyKey: "b7c1848c-a003-4b46-a8dd-5a435b7f8d60" }, allowedRecipients).valid, false);
  assert.equal(validateComposeInput({ recipient: allowedRecipients[0], subject: "Hola\r\nBcc: x@y.com", body: "Texto", idempotencyKey: "b7c1848c-a003-4b46-a8dd-5a435b7f8d60" }, allowedRecipients).valid, false);
});

test("el hash idempotente cambia con contenido, destinatario o hilo", () => {
  const base = { recipient: allowedRecipients[0], subject: "Hola", body: "Texto", threadId: null };
  assert.match(hashSendContent(base), /^[0-9a-f]{64}$/u);
  assert.notEqual(hashSendContent(base), hashSendContent({ ...base, body: "Otro" }));
  assert.notEqual(hashSendContent(base), hashSendContent({ ...base, threadId: "hilo" }));
  assert.notEqual(
    hashSendContent({ ...base, attachments: [{ fileName: "a.pdf", mimeType: "application/pdf", size: 5, sha256: "a".repeat(64) }] }),
    hashSendContent({ ...base, attachments: [{ fileName: "a.pdf", mimeType: "application/pdf", size: 5, sha256: "b".repeat(64) }] }),
  );
});

test("reintenta solo lecturas ante cuotas/5xx y respeta Retry-After", () => {
  assert.deepEqual(classifyGmailReadRetry({ response: { status: 429, headers: { "retry-after": "3" } } }), { retryable: true, retryAfterMs: 3000 });
  assert.equal(classifyGmailReadRetry({ response: { status: 503 } }).retryable, true);
  assert.equal(classifyGmailReadRetry({ response: { status: 400 } }).retryable, false);
  assert.equal(getBackoffDelayMs(0, 0), 250);
  assert.equal(getBackoffDelayMs(2, 0), 1000);
});

test("la migración 103 propone RBAC e idempotencia server-only sin cuerpos ni tokens", async () => {
  const migration = await readFile(new URL("../supabase/migrations/103_gmail_operational_mailbox.sql", import.meta.url), "utf8");
  assert.match(migration, /^begin;/mu);
  assert.match(migration, /gmail\.mailbox\.view/u);
  assert.match(migration, /gmail\.mail\.send/u);
  assert.match(migration, /role\.code = 'RESIDENT'/u);
  assert.match(migration, /create table public\.gmail_send_intents/u);
  assert.match(migration, /unique \(user_id, idempotency_key\)/u);
  assert.match(migration, /'PENDING',[\s\S]*'SENDING',[\s\S]*'SENT',[\s\S]*'FAILED',[\s\S]*'UNKNOWN'/u);
  assert.match(migration, /enable row level security/u);
  assert.match(migration, /force row level security/u);
  assert.match(migration, /revoke all on table public\.gmail_send_intents[\s\S]*anon, authenticated/u);
  assert.match(migration, /grant select, insert, update[\s\S]*service_role/u);
  assert.doesNotMatch(migration, /message_body|raw_message|refresh_token|access_token|attachment_data/iu);
  assert.match(migration, /commit;\s*$/u);
});

test("rutas restringen al usuario autenticado, proyecto y permisos sin user_id del navegador", async () => {
  const [service, serverAccess, mailbox, thread, attachment, send, reply] = await Promise.all([
    "../src/features/integrations/gmail/mailbox-service.ts",
    "../src/features/integrations/gmail/server-access.ts",
    "../src/app/api/integrations/gmail/mailbox/route.ts",
    "../src/app/api/integrations/gmail/threads/[threadId]/route.ts",
    "../src/app/api/integrations/gmail/attachments/[messageId]/[attachmentId]/route.ts",
    "../src/app/api/integrations/gmail/send/route.ts",
    "../src/app/api/integrations/gmail/reply/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(service, /getAuthorizedGmailRequestUser/u);
  assert.match(service, /getGmailProjectAccess/u);
  assert.match(serverAccess, /isPlatformAdmin\(input\.userId\)/u);
  assert.match(serverAccess, /getOperationalProjectAccessForProject\(input\.userId, input\.projectId\)/u);
  assert.match(serverAccess, /canUseGmailModule/u);
  assert.doesNotMatch([mailbox, thread, attachment, send, reply].join("\n"), /body\.userId|searchParams\.get\("userId"\)/u);
  assert.match([mailbox, thread, attachment].join("\n"), /private, no-store/u);
  assert.match(send, /hasValidSameOrigin/u);
  assert.match(reply, /hasValidSameOrigin/u);
});

test("sidebar, página, status y APIs comparten el bypass global sin romper aislamiento", async () => {
  const [sidebar, topbar, page, status, service, serverAccess, platformQueries] = await Promise.all([
    "../src/components/layout/app-sidebar.tsx",
    "../src/components/layout/topbar.tsx",
    "../src/app/(dashboard)/mail/page.tsx",
    "../src/app/api/integrations/gmail/status/route.ts",
    "../src/features/integrations/gmail/mailbox-service.ts",
    "../src/features/integrations/gmail/server-access.ts",
    "../src/features/platform/queries.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  assert.match(sidebar, /canUseGmailModule/u);
  assert.match(sidebar, /platformContext\.isPlatformAdmin/u);
  assert.match(topbar, /canViewGmail \? <GmailConnectionIndicator/u);
  assert.match(page, /isPlatformAdmin\(profile\.id\)/u);
  assert.match(page, /if \(!canView\) redirect\("\/"\)/u);
  assert.doesNotMatch(page, /useEffect|router\.replace/u);
  assert.match(status, /hasGmailModuleAccessForUser/u);
  assert.match(serverAccess, /permission: GmailModulePermission/u);
  assert.match(platformQueries, /\.eq\("active", true\)/u);

  assert.match(service, /getAuthorizedGmailClient\(user\.id\)/u);
  assert.match(service, /userId: user\.id/u);
  assert.doesNotMatch(service, /body\.userId/u);
});

test("lecturas son paginadas/concurrencia limitada y envíos no tienen reintento ciego", async () => {
  const service = await readFile(new URL("../src/features/integrations/gmail/mailbox-service.ts", import.meta.url), "utf8");
  assert.match(service, /maxResults: GMAIL_MAILBOX_PAGE_SIZE/u);
  assert.match(service, /pageToken: input\.pageToken/u);
  assert.match(service, /GMAIL_MAILBOX_MAX_CONCURRENCY/u);
  assert.match(service, /withReadRetry/u);
  const sendSection = service.slice(service.indexOf("async function sendWithoutRetry"));
  assert.doesNotMatch(sendSection, /withReadRetry\(.*messages\.send/su);
  assert.match(sendSection, /status: confirmed \? "FAILED" : "UNKNOWN"/u);
  assert.match(service, /\.eq\("user_id", input\.userId\)/u);
  assert.match(service, /\.eq\("status", "PENDING"\)/u);
});

test("descarga revalida mensaje, limita MIME/tamaño y fuerza attachment", async () => {
  const [service, route] = await Promise.all([
    readFile(new URL("../src/features/integrations/gmail/mailbox-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/integrations/gmail/attachments/[messageId]/[attachmentId]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /isAllowedConversationMessage/u);
  assert.match(service, /validateGmailAttachment/u);
  assert.match(service, /attachmentMaxBytes/u);
  assert.match(route, /Content-Disposition/u);
  assert.match(route, /"attachment"/u);
  assert.match(route, /X-Content-Type-Options/u);
  assert.match(route, /Content-Security-Policy/u);
  assert.match(route, /disposition.*inline/u);
});

test("UI ofrece lista/detalle responsive, compositor accesible y estados vacíos", async () => {
  const [workspace, sidebar, page] = await Promise.all([
    readFile(new URL("../src/features/integrations/gmail/components/gmail-mailbox-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/app-sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(dashboard)/mail/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /label: "Correo"[\s\S]*permission: "gmail\.mailbox\.view"/u);
  assert.match(page, /gmail\.mailbox\.view/u);
  assert.match(workspace, /lg:grid-cols-/u);
  assert.match(workspace, /hidden lg:block/u);
  assert.match(workspace, /Volver a conversaciones/u);
  assert.match(workspace, /Redactar correo/u);
  assert.match(workspace, /Sin correos recibidos permitidos/u);
  assert.match(workspace, /Sin correos enviados/u);
  assert.match(workspace, /Gmail requiere reconexión/u);
  assert.match(workspace, /role="tablist"/u);
  assert.match(workspace, /focus-visible:ring/u);
  assert.doesNotMatch(workspace, /dangerouslySetInnerHTML/u);
});

test("bundle cliente no importa googleapis, cifrado, service role ni secretos", async () => {
  const workspace = await readFile(new URL("../src/features/integrations/gmail/components/gmail-mailbox-workspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(workspace, /googleapis|createAdminClient|refresh_token|access_token|TOKEN_ENCRYPTION|client_secret/iu);
});

test("la bandeja no activa pipeline, cron, pubsub ni cambios de programación", async () => {
  const files = await Promise.all([
    "../src/features/integrations/gmail/mailbox-service.ts",
    "../src/features/integrations/gmail/components/gmail-mailbox-workspace.tsx",
    "../src/app/api/integrations/gmail/send/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /classifyUniversalInvoice|programming|pubsub|webhook|cron/iu);
});
