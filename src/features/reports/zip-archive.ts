import JSZip from "jszip";

import { reportArchivePath, type ReportArchiveItem } from "./export-utils.ts";

export type ReportArchiveVersion = {
  document_id: string;
  file_name: string;
  mime_type: string;
  storage_bucket: string;
  storage_path: string;
  file_size: number | string;
};

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export class ReportArchiveTooLargeError extends Error {
  constructor() {
    super("Los adjuntos superan el tamaño permitido para una descarga. Reduce el período o filtra por pedido para descargar el expediente completo.");
    this.name = "ReportArchiveTooLargeError";
  }
}

export async function createReportZip(
  items: ReportArchiveItem[],
  versions: ReportArchiveVersion[],
  {
    includeProjectFolders,
    download,
    maxBytes = MAX_ARCHIVE_BYTES,
  }: {
    includeProjectFolders: boolean;
    download: (version: ReportArchiveVersion) => Promise<ArrayBuffer>;
    maxBytes?: number;
  },
) {
  const versionByDocument = new Map(versions.map((version) => [version.document_id, version]));
  const declaredBytes = items.reduce((sum, item) => sum + Number(versionByDocument.get(item.documentId)?.file_size ?? 0), 0);
  if (declaredBytes > maxBytes) throw new ReportArchiveTooLargeError();
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const downloaded = new Map<string, ArrayBuffer>();
  const unavailable: string[] = [];
  const contents: string[] = [];
  let fileCount = 0;
  let actualBytes = 0;
  for (const item of items) {
    const version = versionByDocument.get(item.documentId);
    if (!version) {
      unavailable.push(`Pedido ${item.orderNumber ?? "sin número"} · ${item.dispatchCode} · Documento ${item.documentId}: sin versión vigente cargada o accesible.`);
      continue;
    }
    let bytes = downloaded.get(item.documentId);
    if (!bytes) {
      // Any Storage failure aborts the export; never return a silently partial
      // archive containing only the attachments downloaded before the failure.
      bytes = await download(version);
      downloaded.set(item.documentId, bytes);
    }
    actualBytes += bytes.byteLength;
    if (actualBytes > maxBytes) throw new ReportArchiveTooLargeError();
    const path = reportArchivePath(item, usedPaths, {
      includeProject: includeProjectFolders, fileName: version.file_name, mimeType: version.mime_type,
    });
    zip.file(path, bytes);
    contents.push(path);
    fileCount += 1;
  }
  if (fileCount) {
    zip.file("CONTENIDO.txt", [
      "PRO Procesos · Expedientes del resultado filtrado de Reportería",
      "Facturas vigentes y evidencias del despacho, sus guías e incidencias.",
      "Archivos originales de la versión vigente cargada. No se incluyen versiones anteriores ni adjuntos eliminados.",
      `Archivos incluidos: ${fileCount}. Adjuntos no disponibles: ${unavailable.length}.`,
      "", ...contents,
    ].join("\r\n"));
    if (unavailable.length) zip.file("ADJUNTOS_NO_DISPONIBLES.txt", unavailable.join("\r\n"));
  }
  return { zip, fileCount };
}
