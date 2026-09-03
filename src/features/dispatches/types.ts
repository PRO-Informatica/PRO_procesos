export const DISPATCH_STATUSES = ["IN_EXECUTION", "COMPLETED"] as const;
export const DISPATCH_RESULTS = ["DISPATCHED", "NOT_DISPATCHED"] as const;

export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];
export type DispatchResult = (typeof DISPATCH_RESULTS)[number];
export type ProgrammingDispatchStatus = "CONFIRMED" | "IN_EXECUTION";
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

export type DispatchGuide = {
  id: string;
  guideNumber: string;
  guideDate: string;
  quantity: number;
  unitCode: string;
  productCount: number;
  lines: DispatchGuideLine[];
};

export type ProgrammingDispatchItem = {
  programmingId: string;
  programmingCode: string;
  programmingStatus: ProgrammingDispatchStatus;
  scheduledAt: string;
  supplierId: string;
  supplierName: string;
  programmedVolume: number;
  unitCode: string;
  dispatchId: string | null;
  dispatchStatus: DispatchStatus | null;
  result: DispatchResult | null;
  realVolume: number | null;
  realUnitCode: string | null;
  version: number | null;
  guideCount: number;
  guideTotal: number;
  guides: DispatchGuide[];
};

export type DispatchPageData = {
  items: ProgrammingDispatchItem[];
  units: DispatchUnit[];
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
  context: "dispatch" | "guide" | "incident";
  contextId: string;
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
  removedAt: string | null;
};

export type DispatchDetail = {
  id: string;
  projectId: string;
  programmingId: string;
  programmingCode: string;
  programmingStatus: ProgrammingDispatchStatus;
  programmingScheduledAt: string;
  supplierId: string;
  supplierName: string;
  programmedVolume: number;
  programmedUnitCode: string;
  status: DispatchStatus;
  result: DispatchResult | null;
  version: number;
  arrivalAt: string | null;
  departureAt: string | null;
  receivedByName: string | null;
  orderNumber: string | null;
  realVolume: number | null;
  realUnitCode: string | null;
  completedAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  guideTotal: number;
  guides: DispatchGuide[];
  incidents: DispatchIncident[];
  documents: DispatchDocument[];
  batches: DispatchBatchRelation[];
  reconciliation: {
    status: string;
    productInvoiceNumber: string | null;
    serviceInvoiceNumber: string | null;
    latestDifference: number | null;
  } | null;
  incidentTypes: IncidentTypeOption[];
  units: DispatchUnit[];
};

export type DispatchPermissions = {
  canCreate: boolean;
  canModify: boolean;
  canManageBatch: boolean;
  canRegisterIncident: boolean;
};

export type DispatchMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  dispatchId?: string;
  guideId?: string;
  newVersion?: number;
  conflict?: boolean;
};

export const initialDispatchMutationState: DispatchMutationState = {
  status: "idle",
};

export type IncidentMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  incidentId?: string;
};

export const initialIncidentMutationState: IncidentMutationState = {
  status: "idle",
};

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
