import type { GuideReportData, ReportInvoice } from "./types";

export type ReportEvidence = {
  projectId: string;
  dispatchId: string;
  documentId: string;
  context: "dispatch" | "guide" | "incident";
  contextId: string;
  guideNumber?: string | null;
};

type ReportArchiveLocation = {
  projectId: string;
  projectName: string;
  projectCode: string;
  dispatchId: string;
  dispatchCode: string;
  orderNumber: string | null;
  documentId: string;
};

export type ReportArchiveItem = ReportArchiveLocation & (
  | { kind: "invoice"; invoice: ReportInvoice }
  | { kind: "evidence"; evidence: ReportEvidence }
);

export function sanitizeArchiveSegment(value: string, fallback = "Sin_nombre") {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/-+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 100);
  return sanitized || fallback;
}

export function uniqueArchivePath(path: string, usedPaths: Set<string>) {
  const key = (value: string) => value.normalize("NFC").toLowerCase();
  if (!usedPaths.has(key(path))) {
    usedPaths.add(key(path));
    return path;
  }
  const dot = path.lastIndexOf(".");
  const base = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const extension = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  let counter = 2;
  let candidate = `${base}_${counter}${extension}`;
  while (usedPaths.has(key(candidate))) {
    counter += 1;
    candidate = `${base}_${counter}${extension}`;
  }
  usedPaths.add(key(candidate));
  return candidate;
}

export function reportArchiveItems(report: GuideReportData, evidence: ReportEvidence[] = []): ReportArchiveItem[] {
  const byDispatch = new Map<string, ReportEvidence[]>();
  for (const document of evidence) {
    const key = `${document.projectId}:${document.dispatchId}`;
    byDispatch.set(key, [...(byDispatch.get(key) ?? []), document]);
  }
  const seen = new Set<string>();
  return report.rows.flatMap((dispatch) => {
    const location = {
      projectId: dispatch.projectId,
      projectName: dispatch.projectName,
      projectCode: dispatch.projectCode,
      dispatchId: dispatch.dispatchId,
      dispatchCode: dispatch.dispatchCode,
      orderNumber: dispatch.orderNumber,
    };
    const items: ReportArchiveItem[] = [dispatch.productInvoice, dispatch.serviceInvoice]
      .filter((invoice): invoice is ReportInvoice => Boolean(invoice?.documentId))
      .map((invoice) => ({ ...location, documentId: invoice.documentId!, kind: "invoice", invoice }));
    for (const document of byDispatch.get(`${dispatch.projectId}:${dispatch.dispatchId}`) ?? []) {
      items.push({ ...location, documentId: document.documentId, kind: "evidence", evidence: document });
    }
    return items.filter((item) => {
      const key = `${item.projectId}:${item.dispatchId}:${item.documentId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

export function reportArchivePath(
  item: ReportArchiveItem,
  usedPaths: Set<string>,
  { includeProject = false, fileName, mimeType }: { includeProject?: boolean; fileName?: string; mimeType?: string } = {},
) {
  const order = item.orderNumber
    ? sanitizeArchiveSegment(item.orderNumber, "Sin_numero")
    : `Sin_numero_${sanitizeArchiveSegment(item.dispatchCode)}`;
  const projectFolder = includeProject
    ? `Proyecto_${sanitizeArchiveSegment(`${item.projectName}_${item.projectCode}`, "Proyecto")}_${sanitizeArchiveSegment(item.projectId)}/`
    : "";
  const root = `${projectFolder}Pedido_${order}/Despacho_${sanitizeArchiveSegment(item.dispatchId)}/`;
  if (item.kind === "invoice") {
    const type = item.invoice.type === "PRODUCT" ? "Producto" : "Servicio";
    const invoiceNumber = sanitizeArchiveSegment(item.invoice.number, "Sin_numero");
    return uniqueArchivePath(`${root}Facturas/Factura_${type}_${invoiceNumber}.pdf`, usedPaths);
  }
  const evidence = item.evidence;
  const folder = evidence.context === "guide"
    ? `Guias/Guia_${sanitizeArchiveSegment(evidence.guideNumber ?? "Sin_numero")}_${sanitizeArchiveSegment(evidence.contextId)}`
    : evidence.context === "incident"
      ? `Incidencias/Incidencia_${sanitizeArchiveSegment(evidence.contextId)}`
      : "Despacho";
  return uniqueArchivePath(`${root}Evidencias/${folder}/${archiveFileName(fileName, mimeType, item.documentId)}`, usedPaths);
}

function archiveFileName(fileName: string | undefined, mimeType: string | undefined, documentId: string) {
  const originalExtension = fileName?.match(/\.([a-z0-9]{1,10})$/iu)?.[0];
  const extension = originalExtension
    ?? ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mimeType ?? ""] ?? "");
  const stem = fileName && originalExtension ? fileName.slice(0, -originalExtension.length) : fileName;
  return `${sanitizeArchiveSegment(stem ?? "", `Documento_${sanitizeArchiveSegment(documentId)}`)}${extension}`;
}
