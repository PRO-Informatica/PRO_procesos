export type GuideReportFilters = {
  period?: "day" | "week" | "month" | "custom";
  projectId?: string;
  supplierId?: string;
  userId?: string;
  orderNumber?: string;
  batchId?: string;
  dispatchStatus?: string;
  programmingStatus?: string;
  orderStatus?: string;
  reconciliationStatus?: string;
  withIncidents?: "yes" | "no";
  dateFrom: string;
  dateTo: string;
};

export type ReportOption = { value: string; label: string };

export type ReportInvoice = {
  id: string;
  type: "PRODUCT" | "SERVICE";
  number: string;
  date: string;
  status: string;
  subtotal: number;
  total: number;
  currency: string;
  orderNumber: string | null;
  pcaOriginal: string | null;
  invoicedQuantity: number | null;
  unitCode: string | null;
  documentId: string | null;
  fileName: string | null;
  extractionStatus: string | null;
  supplierLegalName: string | null;
  supplierTaxId: string | null;
  billingLegalName: string | null;
  billingTaxId: string | null;
};

export type GuideReportRow = {
  dispatchId: string;
  dispatchCode: string;
  projectId: string;
  projectName: string;
  timezone: string;
  supplierId: string;
  supplierName: string;
  programmingCode: string;
  orderNumber: string | null;
  batchId: string | null;
  batchCode: string | null;
  guideCount: number;
  documentedQuantity: number;
  unitCode: string;
  receivedQuantity: number;
  physicalResult: string;
  dispatchStatus: string;
  registeredById: string;
  registeredByName: string;
  createdAt: string;
  incidentCount: number;
  documentCount: number;
  orderStatus: string;
  reinvoicingRequired: boolean;
  reconciliationStatus: string;
  productInvoicedQuantity: number;
  difference: number;
  invoiceCount: number;
  productInvoice: ReportInvoice | null;
  serviceInvoice: ReportInvoice | null;
};

export type ProgrammingReportItem = {
  id: string;
  code: string;
  projectId: string;
  projectName: string;
  timezone: string;
  supplierId: string;
  supplierName: string;
  scheduledAt: string;
  requestedQuantity: number;
  confirmedQuantity: number | null;
  unitCode: string;
  status: string;
  createdById: string;
  createdByName: string;
  dispatches: GuideReportRow[];
};

export type GuideReportData = {
  rows: GuideReportRow[];
  programming: ProgrammingReportItem[];
  filters: {
    projects: ReportOption[];
    suppliers: ReportOption[];
    users: ReportOption[];
    batches: ReportOption[];
  };
};
