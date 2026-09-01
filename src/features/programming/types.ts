export const PROGRAMMING_STATUSES = [
  "DRAFT",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "IN_EXECUTION",
  "COMPLETED",
  "CANCELLED",
] as const;

export type ProgrammingStatus = (typeof PROGRAMMING_STATUSES)[number];

export const PROGRAMMING_EFFECTIVE_STATUSES = [
  ...PROGRAMMING_STATUSES,
  "EXPIRED",
] as const;

export type ProgrammingEffectiveStatus =
  (typeof PROGRAMMING_EFFECTIVE_STATUSES)[number];

export type ProgrammingDispatch = {
  id: string;
  status: string;
  result: string | null;
  createdAt: string;
  guideNumber: string | null;
  guideDate: string | null;
  quantity: number | null;
  unitCode: string | null;
};

export type ProgrammingLine = {
  id: string;
  quantity: number;
  unitCode: string;
  position: number;
};

export type ProgrammingItem = {
  id: string;
  projectId: string;
  supplierId: string;
  supplierName: string;
  scheduledAt: string;
  requestedQuantity: number;
  confirmedQuantity: number | null;
  unitCode: string;
  placementGroup: string | null;
  requiresPumping: boolean;
  estimatedWorkItemId: string | null;
  estimatedWorkItemLabel: string | null;
  status: ProgrammingStatus;
  effectiveStatus: ProgrammingEffectiveStatus;
  notes: string | null;
  createdByName: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
  lines: ProgrammingLine[];
  dispatches: ProgrammingDispatch[];
};

export type ProgrammingRevision = {
  id: string;
  revisionNo: number;
  version: number;
  action: string;
  status: ProgrammingStatus;
  supplierName: string;
  scheduledAt: string;
  requestedQuantity: number;
  confirmedQuantity: number | null;
  unitCode: string;
  notes: string | null;
  changeReason: string | null;
  actorName: string;
  createdAt: string;
  lines: ProgrammingLine[];
};

export type ProgrammingDetail = ProgrammingItem & {
  version: number;
  createdAt: string;
  updatedAt: string;
  dispatchedQuantity: number;
  remainingQuantity: number;
  excessQuantity: number;
  revisions: ProgrammingRevision[];
};

export type ProgrammingDetailPermissions = {
  canModify: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  canClose: boolean;
  canCreateDispatch: boolean;
  canModifyDispatch: boolean;
};

export type ProgrammingDetailPageData = {
  detail: ProgrammingDetail;
  suppliers: ProgrammingSupplier[];
  units: ProgrammingUnit[];
};

export type ProgrammingSupplier = {
  id: string;
  code: string;
  name: string;
};

export type ProgrammingUnit = {
  code: string;
  name: string;
};

export type ProgrammingRange = {
  start: string;
  end: string;
};

export type ProgrammingFilters = {
  supplierId?: string;
  status?: ProgrammingEffectiveStatus;
};

export type ProgrammingPageData = {
  items: ProgrammingItem[];
  suppliers: ProgrammingSupplier[];
  units: ProgrammingUnit[];
  range: ProgrammingRange;
};

export type ProgrammingLoadResult =
  | { status: "success"; items: ProgrammingItem[] }
  | { status: "error"; message: string };

export type CreateProgrammingState = {
  status: "idle" | "success" | "error";
  message?: string;
  programmingId?: string;
  fields?: {
    supplierId?: string;
    scheduledAt?: string;
    lines?: Array<{ quantity: string; unitCode: string }>;
    notes?: string;
  };
};

export const initialCreateProgrammingState: CreateProgrammingState = {
  status: "idle",
};

export type ProgrammingMutationIntent =
  | "edit"
  | "submit"
  | "return-to-draft"
  | "confirm"
  | "cancel"
  | "close";

export type ProgrammingMutationState = {
  status: "idle" | "success" | "error";
  message?: string;
  intent?: ProgrammingMutationIntent;
  conflict?: boolean;
};

export const initialProgrammingMutationState: ProgrammingMutationState = {
  status: "idle",
};
