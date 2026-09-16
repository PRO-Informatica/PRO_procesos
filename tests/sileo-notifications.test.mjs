import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
const toaster = await read("../src/components/feedback/app-toaster.tsx");
const notify = await read("../src/lib/notify.ts");
const actionNotifications = await read("../src/components/feedback/use-action-notification.ts");
const universalInvoices = await read("../src/features/invoices/universal/components/universal-invoices-workspace.tsx");
const invoiceDialogs = await read("../src/features/batches/components/invoice-dialogs.tsx");
const documentUploader = await read("../src/features/dispatches/components/document-uploader.tsx");
const bulkProgramming = await read("../src/features/programming/components/bulk-programming-dialog.tsx");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("Sileo tiene un único Toaster global y sigue el tema activo", async () => {
  const files = await sourceFiles(new URL("../src", import.meta.url).pathname);
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  assert.equal(sources.reduce((count, source) => count + (source.match(/<Toaster\b/gu)?.length ?? 0), 0), 1);
  assert.match(toaster, /useTheme\(\)/u);
  assert.match(toaster, /resolvedTheme === "dark" \|\| resolvedTheme === "light"/u);
  assert.match(toaster, /position="top-center"/u);
  assert.match(toaster, /env\(safe-area-inset-top\)/u);
  assert.match(toaster, /roundness: 14/u);
});

test("el helper central asigna severidad, duración y protege errores técnicos", () => {
  assert.match(notify, /success: 3200/u);
  assert.match(notify, /warning: 6000/u);
  assert.match(notify, /error: 7000/u);
  assert.match(notify, /sileo\.success/u);
  assert.match(notify, /sileo\.error/u);
  assert.match(notify, /sileo\.warning/u);
  assert.match(notify, /sileo\.info/u);
  assert.match(notify, /sileo\.action/u);
  assert.match(notify, /sileo\.dismiss/u);
  assert.match(notify, /TECHNICAL_ERROR/u);
  assert.match(actionNotifications, /error \?\? notifications\.actionFailed/u);
});

test("las cargas masivas emiten un resumen final y conservan el detalle local", () => {
  const commitStart = universalInvoices.indexOf("const commit = async");
  const commitEnd = universalInvoices.indexOf("const decideException", commitStart);
  const commit = universalInvoices.slice(commitStart, commitEnd);
  assert.doesNotMatch(commit, /notify\.error\("Error al procesar"/u);
  assert.match(commit, /Carga finalizada con observaciones/u);
  assert.match(commit, /status: "ERROR"/u);
  assert.match(invoiceDialogs, /const requiresReview/u);
  assert.match(invoiceDialogs, /Carga finalizada con observaciones/u);
  assert.match(documentUploader, /else if \(completed === 0\)/u);
  assert.match(documentUploader, /Carga finalizada con observaciones/u);
});

test("los resultados de negocio usan warning y las notificaciones repetidas se deduplican", () => {
  assert.match(invoiceDialogs, /inspection\.status === "WITH_DIFFERENCES"/u);
  assert.match(invoiceDialogs, /notify\.warning\("Factura cargada con diferencias"/u);
  assert.match(invoiceDialogs, /notify\.warning\("Factura pendiente de decisión"/u);
  assert.match(bulkProgramming, /notifiedBatch/u);
  assert.match(bulkProgramming, /notifiedBatch\.current === notificationKey/u);
});
