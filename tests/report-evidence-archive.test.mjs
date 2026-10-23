import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";

import { getReportEvidence } from "../src/features/reports/archive-queries.ts";
import { reportArchiveItems, reportArchivePath } from "../src/features/reports/export-utils.ts";
import { createReportZip, ReportArchiveTooLargeError } from "../src/features/reports/zip-archive.ts";
import { reportZipResponse } from "../src/features/reports/zip-response.ts";

const dispatch = (id = "dispatch-a", projectId = "project-a") => ({
  projectId, projectName: "Obra", projectCode: "PRO", dispatchId: id, dispatchCode: `DSP-${id}`,
  orderNumber: "00047", productInvoice: null, serviceInvoice: null,
});
const report = (...rows) => ({ rows });
const evidence = (documentId, context = "dispatch", extras = {}) => ({
  projectId: "project-a", dispatchId: "dispatch-a", documentId, context,
  contextId: context === "dispatch" ? "dispatch-a" : `${context}-a`, guideNumber: "0001", ...extras,
});
const version = (id, fileName = `${id}.pdf`, mimeType = "application/pdf", size = 20) => ({
  document_id: id, file_name: fileName, mime_type: mimeType, file_size: size,
  storage_bucket: "private-documents", storage_path: `project-a/${id}`,
});

function fakeClient(tables, calls = []) {
  return {
    from(table) {
      const filters = [];
      const orders = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        order(key) { orders.push(key); return query; },
        range(from, to) {
          calls.push({ table, from, to });
          const values = [...(tables[table] ?? [])].filter((row) => filters.every((filter) => filter(row)));
          values.sort((a, b) => {
            for (const key of orders) {
              const order = String(a[key]).localeCompare(String(b[key]));
              if (order) return order;
            }
            return 0;
          });
          return Promise.resolve({ data: values.slice(from, to + 1), error: null });
        },
      };
      return query;
    },
  };
}

test("consulta evidencias de despacho, guía e incidencia solo del resultado filtrado", async () => {
  const client = fakeClient({
    dispatch_documents: [
      { project_id: "project-a", dispatch_id: "dispatch-a", document_id: "direct" },
      { project_id: "project-a", dispatch_id: "excluded", document_id: "not-filtered" },
      { project_id: "project-b", dispatch_id: "dispatch-a", document_id: "foreign" },
    ],
    dispatch_guides: [{ id: "g-a", project_id: "project-a", dispatch_id: "dispatch-a", guide_number: "001" }],
    guide_documents: [
      { project_id: "project-a", guide_id: "g-a", document_id: "guide" },
      { project_id: "project-a", guide_id: "g-other", document_id: "foreign-guide" },
    ],
    dispatch_incidents: [{ id: "i-a", project_id: "project-a", dispatch_id: "dispatch-a" }],
    incident_documents: [{ project_id: "project-a", incident_id: "i-a", document_id: "incident" }],
  });
  const result = await getReportEvidence(client, [dispatch()]);
  assert.deepEqual(result.map((item) => item.documentId), ["direct", "guide", "incident"]);
  assert.equal(result[1].guideNumber, "001");
  assert.deepEqual(await getReportEvidence(client, []), []);
});

test("pagina todos los adjuntos, sin truncarlos en el límite de Supabase", async () => {
  const calls = [];
  const documents = Array.from({ length: 1201 }, (_, index) => ({
    project_id: "project-a", dispatch_id: "dispatch-a", document_id: `doc-${index}`,
  }));
  const result = await getReportEvidence(fakeClient({ dispatch_documents: documents }, calls), [dispatch()]);
  assert.equal(result.length, 1201);
  assert.deepEqual(calls.filter((call) => call.table === "dispatch_documents").map((call) => call.from), [0, 500, 1000]);
});

test("una falla de consulta no produce un ZIP aparentemente completo", async () => {
  const client = { from() {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
      range: () => Promise.resolve({ data: null, error: { message: "not authorized" } }) };
    return query;
  } };
  await assert.rejects(() => getReportEvidence(client, [dispatch()]), /consultar los adjuntos/u);
});

test("no incorpora evidencia ajena aunque se repita el número de pedido", () => {
  const items = reportArchiveItems(report(dispatch()), [evidence("ok"), evidence("foreign", "dispatch", { projectId: "project-b" }),
    evidence("other-dispatch", "dispatch", { dispatchId: "dispatch-b" })]);
  assert.deepEqual(items.map((item) => item.documentId), ["ok"]);
});

test("deduplica vínculos repetidos por despacho sin perder expedientes compartidos", async () => {
  const rows = report(dispatch(), dispatch("dispatch-b"));
  const items = reportArchiveItems(rows, [evidence("same"), evidence("same", "guide"),
    evidence("same", "dispatch", { dispatchId: "dispatch-b" })]);
  assert.equal(items.length, 2);
  let downloads = 0;
  const result = await createReportZip(items, [version("same")], {
    includeProjectFolders: false, download: async () => { downloads += 1; return new Uint8Array([1, 2]).buffer; },
  });
  assert.equal(result.fileCount, 2);
  assert.equal(downloads, 1);
  const files = Object.keys(result.zip.files).filter((name) => name.endsWith("same.pdf"));
  assert.equal(files.length, 2);
  assert.notEqual(files[0], files[1]);
});

test("ZIP real preserva bytes PDF/fotos y agrupa guía e incidencia aunque no haya facturas", async () => {
  const sources = { pdf: new TextEncoder().encode("%PDF-1.7 original"), photo: new Uint8Array([255, 216, 255, 0, 100]),
    incident: new Uint8Array([137, 80, 78, 71]) };
  const items = reportArchiveItems(report(dispatch()), [evidence("pdf"), evidence("photo", "guide"), evidence("incident", "incident")]);
  const result = await createReportZip(items, [version("pdf", "Control.pdf"), version("photo", "Foto.JPG", "image/jpeg"),
    version("incident", "Incidencia.png", "image/png")], {
    includeProjectFolders: false, download: async (v) => sources[v.document_id].buffer,
  });
  const reopened = await JSZip.loadAsync(await result.zip.generateAsync({ type: "uint8array" }), { checkCRC32: true });
  assert.equal(result.fileCount, 3);
  assert.deepEqual(await reopened.file("Pedido_00047/Despacho_dispatch-a/Evidencias/Despacho/Control.pdf").async("uint8array"), sources.pdf);
  const photo = Object.keys(reopened.files).find((path) => path.includes("/Guias/Guia_0001_guide-a/") && path.endsWith("Foto.JPG"));
  const incident = Object.keys(reopened.files).find((path) => path.includes("/Incidencias/") && path.endsWith("Incidencia.png"));
  assert.deepEqual(await reopened.file(photo).async("uint8array"), sources.photo);
  assert.deepEqual(await reopened.file(incident).async("uint8array"), sources.incident);
});

test("nombres largos, colisiones por mayúsculas y rutas maliciosas no sobrescriben archivos", () => {
  const item = reportArchiveItems(report(dispatch()), [evidence("doc")])[0];
  const used = new Set();
  const a = reportArchivePath(item, used, { fileName: "Foto.JPG" });
  const b = reportArchivePath(item, used, { fileName: "foto.jpg" });
  assert.notEqual(a.toLowerCase(), b.toLowerCase());
  assert.ok(b.endsWith("foto_2.jpg"));
  const escaped = reportArchivePath(item, used, { fileName: "../../archivo/foto.png" });
  assert.ok(!escaped.includes("../") && !escaped.includes("\\"));
  const long = reportArchivePath(item, used, { fileName: `${"a".repeat(200)}.webp` });
  assert.ok(long.endsWith(".webp"));
  const noExtension = reportArchivePath(item, used, { fileName: "Evidencia", mimeType: "image/jpeg" });
  assert.ok(noExtension.endsWith("Evidencia.jpg"));
});

test("proyectos con nombre/código idénticos mantienen carpetas independientes", () => {
  const rows = report(dispatch(), dispatch("dispatch-a", "project-b"));
  const items = reportArchiveItems(rows, [evidence("a"), evidence("b", "dispatch", { projectId: "project-b" })]);
  const used = new Set();
  const paths = items.map((item) => reportArchivePath(item, used, { includeProject: true, fileName: "foto.jpg" }));
  assert.notEqual(paths[0].split("/")[0], paths[1].split("/")[0]);
});

test("advierte adjuntos sin versión actual cargada y falla si Storage no entrega un archivo", async () => {
  const items = reportArchiveItems(report(dispatch()), [evidence("ok"), evidence("pending")]);
  const result = await createReportZip(items, [version("ok")], {
    includeProjectFolders: false, download: async () => new Uint8Array([1]).buffer,
  });
  assert.equal(result.fileCount, 1);
  assert.match(await result.zip.file("ADJUNTOS_NO_DISPONIBLES.txt").async("string"), /pending/u);
  assert.match(await result.zip.file("CONTENIDO.txt").async("string"), /Adjuntos no disponibles: 1/u);
  await assert.rejects(() => createReportZip(items, [version("ok")], {
    includeProjectFolders: false, download: async () => { throw new Error("Storage failure"); },
  }), /Storage failure/u);
});

test("no devuelve un ZIP vacío con solo el índice", async () => {
  const result = await createReportZip(reportArchiveItems(report(dispatch()), [evidence("missing")]), [], {
    includeProjectFolders: false, download: async () => { throw new Error("unexpected"); },
  });
  assert.equal(result.fileCount, 0);
  assert.equal(Object.keys(result.zip.files).length, 0);
});

test("límite de recursos rechaza el conjunto completo sin recortar evidencias", async () => {
  const items = reportArchiveItems(report(dispatch()), [evidence("large")]);
  await assert.rejects(() => createReportZip(items, [version("large", "f.pdf", "application/pdf", 100)], {
    includeProjectFolders: false, maxBytes: 10, download: async () => { throw new Error("should not download"); },
  }), ReportArchiveTooLargeError);
  await assert.rejects(() => createReportZip(items, [version("large", "f.pdf", "application/pdf", 1)], {
    includeProjectFolders: false, maxBytes: 10, download: async () => new Uint8Array(100).buffer,
  }), ReportArchiveTooLargeError);
});

test("respuesta ZIP transmite y permite reabrir más de 4.5 MB sin alterar archivos", async () => {
  const zip = new JSZip();
  const bytes = randomBytes(5 * 1024 * 1024);
  zip.file("evidencia.jpg", bytes);
  const response = reportZipResponse(zip, "Reporte.zip");
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-length"), null);
  const reader = response.body.getReader();
  const chunks = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  assert.ok(chunks.length > 2);
  const binary = Buffer.concat(chunks);
  assert.ok(binary.byteLength > 4.5 * 1024 * 1024);
  const reopened = await JSZip.loadAsync(binary, { checkCRC32: true });
  assert.deepEqual(await reopened.file("evidencia.jpg").async("nodebuffer"), bytes);
});

test("ruta consulta metadatos bajo RLS y únicamente versiones actuales cargadas", async () => {
  const route = await readFile(new URL("../src/app/(dashboard)/reports/export/route.ts", import.meta.url), "utf8");
  assert.match(route, /getReportEvidence\(client, report.rows\)/u);
  assert.match(route, /client.from\("document_versions"\)/u);
  assert.match(route, /\.eq\("upload_status", "UPLOADED"\)\.eq\("is_current", true\)/u);
  assert.match(route, /return reportZipResponse\(zip,/u);
  assert.doesNotMatch(route, /admin.from\("document_versions"\)/u);
});
