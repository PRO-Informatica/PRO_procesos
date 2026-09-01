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
  orderNumber: string | null;
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
  invoices: BatchInvoice[];
  correctionReasons: InvoiceCorrectionReason[];
  invoiceSummary: InvoiceReconciliationSummary;
  orders: ReconciliationOrderSummary[];
};

export type OrderDocumentStatus =
  "OPEN" | "DOCUMENTS_LOADING" | "READY_TO_RECONCILE" | "CLOSED";
export type OrderReconciliationStatus =
  | "NOT_EVALUATED"
  | "NO_INVOICES"
  | "PARTIAL"
  | "MATCHED"
  | "WITH_DIFFERENCES"
  | "REQUIRES_REVIEW";

export type ReconciliationOrderSummary = {
  id: string;
  batchId: string;
  orderNumber: string;
  supplierName: string;
  documentStatus: OrderDocumentStatus;
  reconciliationStatus: OrderReconciliationStatus;
  version: number;
  guideCount: number;
  invoiceCount: number;
  quantitiesByUnit: QuantityByUnit[];
};

export type OrderGuideContribution = {
  guideId: string;
  dispatchId: string;
  guideNumber: string;
  guideDate: string;
  programmingId: string;
  programmingCode: string;
  productCode: string;
  description: string;
  unitCode: string;
  quantity: number;
};

export type OrderInvoiceContribution = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  productCode: string | null;
  description: string;
  unitCode: string | null;
  quantity: number;
};

export type OrderReconciliationLine = {
  id: string;
  productCode: string;
  productDescription: string;
  unitCode: string | null;
  dispatchedTotal: number;
  invoicedTotal: number;
  difference: number;
  status: string;
  guideCount: number;
  invoiceCount: number;
  secondaryDiscrepancies: string[];
  guideContributions: OrderGuideContribution[];
  invoiceContributions: OrderInvoiceContribution[];
};

export type ReconciliationOrderDetail = ReconciliationOrderSummary & {
  projectId: string;
  batchCode: string;
  periodStart: string;
  periodEnd: string;
  accountingPeriod: string;
  batchStatus: BatchStatus;
  guides: Array<{
    guideId: string;
    dispatchId: string;
    guideNumber: string;
    guideDate: string;
    supplierName: string;
    programmingId: string;
    programmingCode: string;
    result: string | null;
    quantity: number;
    receivedQuantity: number;
    unitCode: string;
    documents: OrderGuideDocument[];
  }>;
  invoices: BatchInvoice[];
  lines: OrderReconciliationLine[];
  correctionReasons: InvoiceCorrectionReason[];
  pendingMixtoListoIntakes: MixtoListoPendingIntake[];
};

export type OrderGuideDocument = {
  id: string;
  category: string;
  purpose: string;
  fileName: string | null;
  mimeType: string | null;
  uploadStatus: string | null;
  createdByName: string;
  createdAt: string;
};

export type BatchPermissions = {
  canCreate: boolean;
  canAddGuide: boolean;
  canModify: boolean;
  canCreateInvoice: boolean;
  canMatchInvoice: boolean;
  canReviewInvoice: boolean;
};

export type InvoiceType = "PRODUCT" | "SERVICE";

export type InvoiceLineView = {
  code: string | null;
  description: string;
  quantity: number;
  unitCode: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
};

export type BatchInvoice = {
  id: string;
  type: InvoiceType;
  number: string;
  date: string;
  supplierName: string;
  subtotal: number;
  total: number;
  currency: string;
  status: string;
  orderNumber: string | null;
  pcaOriginal: string | null;
  replacesInvoiceId: string | null;
  replacedByInvoiceId: string | null;
  guideIds: string[];
  guideNumbers: string[];
  lines: InvoiceLineView[];
  documentId: string | null;
  fileName: string | null;
  extractionId: string | null;
  extractionStatus: "PENDING" | "CONFIRMED" | "CORRECTED" | null;
  extractionPayload: Record<string, unknown> | null;
  guideQuantity: number;
  invoiceQuantity: number;
  difference: number | null;
  unitCode: string | null;
  quantityMatch: boolean | null;
  createdByName: string;
  createdAt: string;
};

export type InvoiceCorrectionReason = {
  id: string;
  code: string;
  name: string;
};

export type InvoiceReconciliationSummary = {
  total: number;
  pending: number;
  approved: number;
  reinvoicing: number;
  guidesWithoutProduct: number;
  guidesWithoutService: number;
};

export type InvoiceUploadLine = {
  code?: string;
  description: string;
  quantity: number;
  unit_code?: string;
  unit_price?: number;
  line_total?: number;
};

export type InvoiceExtractionPayload = {
  invoice_number: string;
  invoice_date: string;
  currency: string;
  subtotal: number;
  total: number;
  invoice_type: InvoiceType;
  order_number?: string;
  pca_original?: string | null;
  lines: InvoiceUploadLine[];
};

export type MixtoListoInvoiceLine = {
  quantity: number;
  unit_code: string;
  code: string;
  description: string;
};

export type MixtoListoInvoiceMetadata = {
  invoiceType: InvoiceType;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: number;
  total: number;
  pcaOriginal: string | null;
  detectedOrderNumber: string | null;
};

export type MixtoListoIntakeStatus =
  | "UPLOAD_PENDING"
  | "EXTRACTION_PENDING"
  | "READY_TO_CONFIRM"
  | "ORDER_MISMATCH"
  | "NEEDS_CORRECTION"
  | "CONFIRMED"
  | "FAILED";

export type MixtoListoExtractionPreview = {
  intakeId: string;
  extractionId: string;
  expectedOrderNumber: string;
  status: MixtoListoIntakeStatus;
  observationsRaw: string | null;
  pcaOriginal: string | null;
  detectedOrderNumber: string | null;
  lines: MixtoListoInvoiceLine[];
};

export type MixtoListoPendingIntake = MixtoListoExtractionPreview & {
  invoiceType: InvoiceType;
  invoiceNumber: string;
  createdAt: string;
  replacesInvoiceId: string | null;
};

export type MixtoListoUploadResult =
  | { status: "error"; message: string }
  | {
      status: "success";
      intakeId: string;
      upload: {
        documentId: string;
        versionId: string;
        bucket: string;
        path: string;
        token: string;
      };
    };

export type InvoiceUploadResult =
  | { status: "error"; message: string }
  | {
      status: "success";
      invoiceId: string;
      upload: {
        documentId: string;
        versionId: string;
        bucket: string;
        path: string;
        token: string;
      };
    };

export type BatchMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  batchId?: string;
};

export const initialBatchMutationState: BatchMutationState = { status: "idle" };
