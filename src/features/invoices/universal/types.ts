import type { ProcessedInvoiceType } from "../invoice-processing";

export type UniversalInvoiceStatus =
  | "READY"
  | "READY_WITH_DIFFERENCES"
  | "REQUIRES_REINVOICING"
  | "INVALID_FILE"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_AMBIGUOUS"
  | "DISPATCH_NOT_FOUND"
  | "DISPATCH_AMBIGUOUS"
  | "NO_ACTIVE_BATCH"
  | "UNKNOWN_TYPE"
  | "DUPLICATE"
  | "ERROR";

export type UniversalCandidate = { id: string; label: string };

export type UniversalInvoiceResult = {
  status: UniversalInvoiceStatus;
  message: string;
  fileName: string;
  fileSize: number;
  detectedType: ProcessedInvoiceType;
  invoiceNumber: string | null;
  detectedBillingLegalName: string | null;
  orderNumber: string | null;
  projectId: string | null;
  projectLabel: string | null;
  dispatchId: string | null;
  dispatchLabel: string | null;
  batchId: string | null;
  batchLabel: string | null;
  candidateProjects: UniversalCandidate[];
  candidateDispatches: UniversalCandidate[];
  warnings: string[];
  operation: "NEW" | "REINVOICE";
  replacesInvoiceId: string | null;
  replacesInvoiceNumber: string | null;
};

export type UniversalCommitResult = UniversalInvoiceResult & {
  saved: boolean;
  invoiceId?: string;
  reconciliationStatus?: string;
};
