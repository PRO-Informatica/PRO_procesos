import type { GuideReportData, ReportInvoice } from "./types";

export type ReportArchiveItem = {
  projectId: string;
  dispatchId: string;
  dispatchCode: string;
  orderNumber: string | null;
  invoice: ReportInvoice;
};

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
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const base = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const extension = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  let counter = 2;
  let candidate = `${base}_${counter}${extension}`;
  while (usedPaths.has(candidate)) {
    counter += 1;
    candidate = `${base}_${counter}${extension}`;
  }
  usedPaths.add(candidate);
  return candidate;
}

export function reportArchiveItems(report: GuideReportData): ReportArchiveItem[] {
  return report.rows.flatMap((dispatch) => [dispatch.productInvoice, dispatch.serviceInvoice]
    .filter((invoice): invoice is ReportInvoice => Boolean(invoice?.documentId))
    .map((invoice) => ({
      projectId: dispatch.projectId,
      dispatchId: dispatch.dispatchId,
      dispatchCode: dispatch.dispatchCode,
      orderNumber: dispatch.orderNumber,
      invoice,
    })));
}

export function reportArchivePath(item: ReportArchiveItem, usedPaths: Set<string>) {
  const order = item.orderNumber
    ? sanitizeArchiveSegment(item.orderNumber, "Sin_numero")
    : `Sin_numero_${sanitizeArchiveSegment(item.dispatchCode)}`;
  const type = item.invoice.type === "PRODUCT" ? "Producto" : "Servicio";
  const invoiceNumber = sanitizeArchiveSegment(item.invoice.number, "Sin_numero");
  return uniqueArchivePath(`Pedido_${order}/Factura_${type}_${invoiceNumber}.pdf`, usedPaths);
}
