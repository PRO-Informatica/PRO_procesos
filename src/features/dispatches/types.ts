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
  "RETURNED",
  "REJECTED",
  "NOT_DISPATCHED",
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
  dispatchedQuantity: number | null;
  receivedQuantity: number | null;
  returnedQuantity: number | null;
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
  units: DispatchUnit[];
};

export type DispatchUnit = { code: string; name: string };
export type IncidentTypeOption = { id: string; name: string };

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
  context: "guide" | "incident";
  incidentId: string | null;
  fileName: string | null;
  mimeType: string | null;
  uploadStatus: string | null;
  versionId: string | null;
  createdByName: string;
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
  guideTemplateVersionId: string | null;
  guideProviderExtraData: Record<string, unknown>;
  createdByName: string;
  updatedAt: string;
  guideLines: DispatchGuideLine[];
  incidents: DispatchIncident[];
  documents: DispatchDocument[];
  batches: DispatchBatchRelation[];
  invoices: DispatchInvoiceRelation[];
  incidentTypes: IncidentTypeOption[];
  units: DispatchUnit[];
  orderContext: DispatchOrderContext | null;
};

export type DispatchOrderContext = {
  orderId: string;
  batchId: string;
  batchCode: string;
  orderNumber: string;
  guideCount: number;
  invoiceCount: number;
  documentStatus: string;
  reconciliationStatus: string;
};

export type DispatchPermissions = {
  canCreate: boolean;
  canModify: boolean;
  canRegisterIncident: boolean;
};

export type DispatchMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  dispatchId?: string;
  guideId?: string;
};

export const initialDispatchMutationState: DispatchMutationState = { status: "idle" };

export type CorrectionMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  newVersion?: number;
  conflict?: boolean;
};

export const initialCorrectionMutationState: CorrectionMutationState = { status: "idle" };

export type IncidentMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  incidentId?: string;
};

export const initialIncidentMutationState: IncidentMutationState = { status: "idle" };

export type PreparedUpload = {
  documentId: string;
  versionId: string;
  versionNumber: number;
  bucket: string;
  path: string;
  token: string;
  expiresAt: string;
};

export type UploadActionResult =
  | { status: "success"; upload: PreparedUpload }
  | { status: "error"; message: string };
