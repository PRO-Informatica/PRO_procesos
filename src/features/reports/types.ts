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

export type GuideReportRow = {
  guideId: string;
  dispatchId: string;
  projectId: string;
  projectName: string;
  timezone: string;
  guideNumber: string;
  guideDate: string;
  guideTime: string | null;
  supplierId: string;
  supplierName: string;
  programmingCode: string;
  orderNumber: string | null;
  batchId: string | null;
  batchCode: string | null;
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
