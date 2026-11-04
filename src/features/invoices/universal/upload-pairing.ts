import { sameFullPca } from "../dispatch-invoice-identity.ts";
import type { UniversalInvoiceResult } from "./types";

export const COMMITTABLE_INVOICE_STATUSES = [
  "READY", "READY_WITH_DIFFERENCES", "REQUIRES_RECIPIENT_EXCEPTION", "REQUIRES_REINVOICING",
];

type ClassifiedUpload = { result: UniversalInvoiceResult | null };
export type InvoiceClassificationStage = "IDENTIFYING" | "PRODUCTS" | "SERVICES";

// Identification only reads type/project/order, not dispatch business rules.
// Then Products are validated sequentially, continuing past missing/invalid
// dispatches. Only after Products are resolved can Services be linked to them.
export async function classifyProductFirst<T extends ClassifiedUpload & { id: string }>(
  targets: T[],
  available: T[],
  handlers: {
    identify: (upload: T) => Promise<T>;
    classify: (upload: T, product: T | null) => Promise<T>;
    onStage: (stage: InvoiceClassificationStage) => void;
  },
  concurrency = 3,
) {
  const uploads = new Map(available.map((upload) => [upload.id, upload]));
  const update = (upload: T) => { uploads.set(upload.id, upload); };
  handlers.onStage("IDENTIFYING");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), targets.length) }, async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      update(await handlers.identify(target));
    }
  }));

  handlers.onStage("PRODUCTS");
  for (const target of targets) {
    const upload = uploads.get(target.id)!;
    if (upload.result?.status === "IDENTIFIED" && upload.result.detectedType === "PRODUCT") {
      update(await handlers.classify(upload, null));
    }
  }

  handlers.onStage("SERVICES");
  for (const target of targets) {
    const upload = uploads.get(target.id)!;
    if (upload.result?.status === "IDENTIFIED" && upload.result.detectedType === "SERVICE") {
      const product = uploadedProductForService(upload, [...uploads.values()]);
      update(await handlers.classify(upload, product));
    }
  }
  return [...uploads.values()];
}

// This is only a request-routing hint. The server re-extracts the companion PDF
// and revalidates its project, dispatch, concrete, supplier and fiscal rules.
export function uploadedProductForService<T extends ClassifiedUpload>(
  service: ClassifiedUpload,
  uploads: T[],
): T | null {
  const invoice = service.result;
  if (invoice?.detectedType !== "SERVICE" || !invoice.projectId || !invoice.orderNumber) return null;
  const candidates = uploads.filter(({ result }) => result
    && result.detectedType === "PRODUCT"
    && COMMITTABLE_INVOICE_STATUSES.includes(result.status)
    && result.dispatchId
    && result.projectId === invoice.projectId
    && result.orderNumber === invoice.orderNumber
    && sameFullPca(result.pcaOriginal, invoice.pcaOriginal));
  return candidates.length === 1 ? candidates[0] : null;
}
