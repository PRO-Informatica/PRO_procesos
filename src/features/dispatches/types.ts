export const DISPATCH_STATUSES = [
  "EXPECTED",
  "REGISTERED",
  "BATCHED",
  "UNDER_REVIEW",
  "RECONCILED",
  "REQUIRES_CORRECTION",
  "CLOSED",
] as const;

export const DISPATCH_RESULTS = [
  "COMPLETE",
  "PARTIAL",
  "NOT_DISPATCHED",
  "RETURNED",
  "REJECTED",
  "CANCELLED",
] as const;

export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];
export type DispatchResult = (typeof DISPATCH_RESULTS)[number];

export type DispatchListItem = {
  id: string;
  projectId: string;
  programmingId: string;
  programmingCode: string;
  supplierId: string;
  supplierName: string;
  status: DispatchStatus;
  result: DispatchResult | null;
  guideId: string | null;
  guideNumber: string | null;
  guideDate: string | null;
  quantity: number | null;
  unitCode: string | null;
  receivedByName: string | null;
  incidentCount: number;
  createdAt: string;
};

export type EligibleProgramming = {
  id: string;
  status: "CONFIRMED" | "IN_EXECUTION";
  scheduledAt: string;
  supplierId: string;
  supplierName: string;
  requestedQuantity: number;
  confirmedQuantity: number | null;
  unitCode: string;
  lineCount: number;
  dispatchCount: number;
  receivedTotal: number;
  remaining: number;
  excess: number;
};

export type DispatchSupplierOption = {
  id: string;
  name: string;
};

export type DispatchPageData = {
  items: DispatchListItem[];
  eligibleProgramming: EligibleProgramming[];
  suppliers: DispatchSupplierOption[];
};

export type DispatchGuideLine = {
  id: string;
  position: number;
  productCode: string;
  productDescription: string;
  quantity: number;
  unitCode: string;
};

export type DispatchIncident = {
  id: string;
  typeName: string;
  responsibility: string;
  chargeApplicability: string;
  notes: string | null;
  reporterName: string;
  createdAt: string;
};

export type DispatchDocument = {
  id: string;
  category: string;
  purpose: string;
  fileName: string | null;
  mimeType: string | null;
  uploadStatus: string | null;
  createdAt: string;
};

export type DispatchBatchRelation = {
  relationId: string;
  batchId: string;
  code: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  accountingPeriod: string;
  assignmentSource: string;
  addedAt: string;
  removedAt: string | null;
  removalReason: string | null;
};

export type DispatchInvoiceRelation = {
  id: string;
  number: string;
  invoiceDate: string;
  invoiceType: string;
  status: string;
  total: number;
  currency: string;
  linkedAt: string;
};

export type DispatchDetail = DispatchListItem & {
  version: number;
  programmingStatus: string;
  programmingScheduledAt: string;
  requestedQuantity: number;
  confirmedQuantity: number | null;
  guideOrderNumber: string | null;
  loadAt: string | null;
  arrivalAt: string | null;
  departureAt: string | null;
  createdByName: string;
  updatedAt: string;
  guideLines: DispatchGuideLine[];
  incidents: DispatchIncident[];
  documents: DispatchDocument[];
  batches: DispatchBatchRelation[];
  invoices: DispatchInvoiceRelation[];
};
