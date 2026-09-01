export const BATCH_STATUSES = [
  "DRAFT",
  "ASSEMBLING",
  "READY_FOR_REVIEW",
  "UNDER_REVIEW",
  "NEEDS_CORRECTION",
  "VALIDATED",
  "PENDING_FINAL_AUTHORIZATION",
  "AUTHORIZED",
  "CLOSED",
  "CANCELLED",
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type BatchSource = "USER" | "SYSTEM";

export type QuantityByUnit = {
  unitCode: string;
  quantity: number;
};

export type BatchSummary = {
  id: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  accountingPeriod: string;
  status: BatchStatus;
  source: BatchSource;
  activeGuideCount: number;
  readyGuideCount: number;
  pendingGuideCount: number;
  rolloverCount: number;
  receivedByUnit: QuantityByUnit[];
  isCurrent: boolean;
};

export type BatchPageData = {
  current: BatchSummary | null;
  history: BatchSummary[];
};

export type BatchGuideRelation = {
  relationId: string;
  active: boolean;
  assignmentSource: BatchSource;
  addedAt: string;
  removedAt: string | null;
  removedByName: string | null;
  removalReason: string | null;
  removalSource: string | null;
  rolledToBatchId: string | null;
  guideId: string;
  guideNumber: string;
  guideDate: string;
  quantity: number;
  receivedQuantity: number;
  unitCode: string;
  supplierName: string;
  programmingId: string;
  programmingCode: string;
  dispatchId: string;
  dispatchStatus: string;
  result: string | null;
  productInvoiceStatus: string | null;
  serviceInvoiceStatus: string | null;
};

export type EligibleBatchGuide = {
  guideId: string;
  guideNumber: string;
  guideDate: string;
  supplierName: string;
  programmingCode: string;
  dispatchId: string;
  receivedQuantity: number;
  unitCode: string;
  result: string | null;
};

export type BatchRolloverPreview = {
  batchGuideId: string;
  guideId: string;
  dispatchId: string;
  guideNumber: string;
  unitCode: string;
  receivedQuantity: number;
  ready: boolean;
  action: "STAY" | "MOVE";
  reason: string;
  destinationBatchId: string | null;
  destinationPeriodStart: string;
  destinationPeriodEnd: string;
  destinationAccountingPeriod: string;
};

export type BatchDetail = BatchSummary & {
  projectId: string;
  activeRelations: BatchGuideRelation[];
  removedRelations: BatchGuideRelation[];
  eligibleGuides: EligibleBatchGuide[];
  preview: BatchRolloverPreview[];
};

export type BatchPermissions = {
  canCreate: boolean;
  canAddGuide: boolean;
  canModify: boolean;
};

export type BatchMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  batchId?: string;
};

export const initialBatchMutationState: BatchMutationState = { status: "idle" };
