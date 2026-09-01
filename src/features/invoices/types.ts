export type GlobalInvoiceItem = {
  id: string;
  number: string;
  type: "PRODUCT" | "SERVICE";
  status: string;
  date: string;
  total: number;
  currency: string;
  supplierName: string;
  pcaOriginal: string | null;
  orderNumber: string | null;
  orderId: string | null;
  batchId: string | null;
  batchCode: string | null;
  replacesInvoiceId: string | null;
  replacedByInvoiceId: string | null;
  documentId: string | null;
  fileName: string | null;
  extractionStatus: "PENDING" | "CONFIRMED" | "CORRECTED" | null;
  createdByName: string;
  createdAt: string;
};

export type GlobalInvoiceData = {
  items: GlobalInvoiceItem[];
  batches: Array<{ id: string; code: string }>;
};
