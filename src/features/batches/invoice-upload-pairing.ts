import { sameFullPca } from "../invoices/dispatch-invoice-identity.ts";
import type { InvoiceInspection } from "./types";

const SAVEABLE_STATUSES: InvoiceInspection["status"][] = [
  "READY", "WITH_DIFFERENCES", "REQUIRES_RECIPIENT_EXCEPTION", "REQUIRES_REINVOICING",
];

type BatchUpload = { inspection: InvoiceInspection | null; saved: boolean };
type SaveableInspection = InvoiceInspection & {
  payload: NonNullable<InvoiceInspection["payload"]>;
  dispatchId: string;
  requestedType: NonNullable<InvoiceInspection["requestedType"]>;
};

export function batchInvoiceCanBeSaved(inspection: InvoiceInspection | null): inspection is SaveableInspection {
  return Boolean(inspection?.payload && inspection.dispatchId && inspection.requestedType
    && !inspection.duplicate && SAVEABLE_STATUSES.includes(inspection.status));
}

export function batchProductForService<T extends BatchUpload>(service: T, uploads: T[]): T | null {
  const invoice = service.inspection;
  if (invoice?.requestedType !== "SERVICE" || !invoice.dispatchId) return null;
  const candidates = uploads.filter((upload) => !upload.saved
    && batchInvoiceCanBeSaved(upload.inspection)
    && upload.inspection?.requestedType === "PRODUCT"
    && upload.inspection.dispatchId === invoice.dispatchId
    && sameFullPca(upload.inspection.payload.pca_original, invoice.pcaOriginal ?? null));
  return candidates.length === 1 ? candidates[0] : null;
}

// Identify every PDF, then validate Products before routing Services. The
// companion is only a routing hint: the server revalidates its original PDF.
export async function inspectBatchInvoiceUploads<T extends BatchUpload>(
  uploads: T[],
  inspect: (upload: T, options: { identifyOnly: boolean; product: T | null }) => Promise<InvoiceInspection>,
): Promise<T[]> {
  const next: T[] = [];
  for (const upload of uploads) {
    next.push(upload.saved ? upload : {
      ...upload, inspection: await inspect(upload, { identifyOnly: true, product: null }),
    });
  }
  for (const type of ["PRODUCT", "SERVICE"] as const) {
    for (let index = 0; index < next.length; index += 1) {
      const upload = next[index];
      if (upload.saved || upload.inspection?.status !== "IDENTIFIED" || upload.inspection.requestedType !== type) continue;
      const product = type === "SERVICE" ? batchProductForService(upload, next) : null;
      next[index] = { ...upload, inspection: await inspect(upload, { identifyOnly: false, product }) };
    }
  }
  return next;
}

// Preserve the displayed/file order while persisting Products before Services,
// including when the user selected a Service PDF first.
export function batchInvoiceSaveOrder(uploads: BatchUpload[]) {
  return uploads.map((_, index) => index).sort((left, right) =>
    Number(uploads[left].inspection?.requestedType !== "PRODUCT")
    - Number(uploads[right].inspection?.requestedType !== "PRODUCT"));
}
