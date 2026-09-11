import type { InvoiceProcessingPayload } from "@/features/invoices/invoice-processing";
import type { ProjectSummary } from "@/features/projects/types";

export const BATCH_STATUSES = ["OPEN", "CLOSED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type BatchSource = "USER" | "SYSTEM";
export type InvoiceType = "PRODUCT" | "SERVICE";
export type ReconciliationStatus = "NOT_STARTED" | "PENDING_RECONCILIATION" | "WITH_DIFFERENCES" | "PENDING_REINVOICING" | "RECONCILED";

export type BatchSummary = {
  id: string; code: string; periodStart: string; periodEnd: string;
  accountingPeriod: string; status: BatchStatus; source: BatchSource;
  activeDispatchCount: number; reconciledCount: number; pendingCount: number;
  rolloverCount: number; isCurrent: boolean;
};

export type BatchPageData = { current: BatchSummary | null; history: BatchSummary[] };

export type UniversalBatchProject = {
  project: ProjectSummary;
  roleCodes: string[];
  permissions: string[];
  batches: BatchSummary[];
};

export type BatchInvoice = {
  id: string; dispatchId: string; type: InvoiceType; number: string; date: string;
  status: string; total: number; currency: string; orderNumber: string | null;
  pcaOriginal: string | null; replacesInvoiceId: string | null;
  replacedByInvoiceId: string | null; documentId: string | null;
  fileName: string | null; extractionId: string | null;
  extractionPayload: InvoiceProcessingPayload | null; createdAt: string;
  recipientException: InvoiceRecipientException | null;
};

export type InvoiceRecipientException = {
  id: string;
  invoiceId: string;
  status: "PENDING" | "APPROVED" | "REINVOICE_REQUESTED";
  detectedBillingLegalName: string;
  detectedIdentity: string;
  decidedByName: string | null;
  decidedAt: string | null;
};

export type ReconciliationAttempt = {
  id: string; attemptNumber: number; productInvoiceId: string;
  expectedOrderNumber: string; detectedOrderNumber: string | null;
  expectedRealVolume: number; expectedUnitCode: string;
  invoicedQuantity: number; invoiceUnitCode: string | null;
  difference: number | null; validations: Record<string, boolean>;
  result: "MATCHED" | "WITH_DIFFERENCES"; executedAt: string;
  executedByName: string;
};

export type BatchDispatchRelation = {
  relationId: string; active: boolean; assignmentSource: BatchSource;
  addedAt: string; removedAt: string | null; removedByName: string | null;
  removalReason: string | null; removalSource: string | null;
  rolledToBatchId: string | null; dispatchId: string; programmingId: string;
  programmingCode: string; orderNumber: string | null; supplierName: string;
  scheduledAt: string; operationalStatus: "IN_EXECUTION" | "COMPLETED";
  realVolume: number | null; realUnitCode: string | null; guideCount: number;
  reconciliationId: string | null; reconciliationStatus: ReconciliationStatus;
  productInvoice: BatchInvoice | null; serviceInvoice: BatchInvoice | null;
  latestAttempt: ReconciliationAttempt | null;
};

export type EligibleBatchDispatch = {
  dispatchId: string; programmingCode: string; orderNumber: string | null;
  supplierName: string; scheduledAt: string;
  operationalStatus: "IN_EXECUTION" | "COMPLETED";
  realVolume: number | null; realUnitCode: string | null;
};

export type BatchRolloverPreview = {
  batchDispatchId: string; dispatchId: string; programmingCode: string;
  reconciled: boolean; action: "STAY" | "MOVE"; reason: string;
  destinationBatchId: string | null; destinationPeriodStart: string;
  destinationPeriodEnd: string; destinationAccountingPeriod: string;
};

export type BatchDetail = BatchSummary & {
  projectId: string; activeRelations: BatchDispatchRelation[];
  removedRelations: BatchDispatchRelation[];
  eligibleDispatches: EligibleBatchDispatch[]; preview: BatchRolloverPreview[];
  secondaryLoaded: boolean;
  loadMetrics: BatchLoadMetrics;
};

export type BatchLoadMetrics = {
  queryCount: number;
  stageCount: number;
  durationMs: number;
};

export type BatchSecondaryData = {
  removedRelations: BatchDispatchRelation[];
  preview: BatchRolloverPreview[];
  loadMetrics: BatchLoadMetrics;
};

export type BatchPermissions = {
  canCreate: boolean; canModify: boolean; canCreateInvoice: boolean;
  canMatchInvoice: boolean; canReviewInvoice: boolean;
};

export type BatchMutationState = { status: "idle" | "success" | "error"; message?: string; batchId?: string };
export const initialBatchMutationState: BatchMutationState = { status: "idle" };

export type InvoiceInspection = {
  fileName: string; dispatchId: string | null; requestedType: InvoiceType | null;
  status: "READY" | "WITH_DIFFERENCES" | "REQUIRES_RECIPIENT_EXCEPTION" | "REQUIRES_REINVOICING" | "IN_EXECUTION" | "DISPATCH_NOT_FOUND" | "ERROR" | "REQUIRES_REVIEW";
  message: string; payload: InvoiceProcessingPayload | null; duplicate: boolean;
  operation?: "NEW" | "REINVOICE";
  replacesInvoiceId?: string | null;
  replacesInvoiceNumber?: string | null;
};
