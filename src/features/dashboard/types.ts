export type ProgrammingStatus =
  | "DRAFT"
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "IN_EXECUTION"
  | "COMPLETED"
  | "CANCELLED";

export type BatchStatus =
  | "DRAFT"
  | "ASSEMBLING"
  | "READY_FOR_REVIEW"
  | "UNDER_REVIEW"
  | "NEEDS_CORRECTION"
  | "VALIDATED"
  | "PENDING_FINAL_AUTHORIZATION"
  | "AUTHORIZED"
  | "CLOSED"
  | "CANCELLED";

export type DashboardProgramming = {
  id: string;
  scheduledAt: string;
  quantity: number;
  unitCode: string;
  status: ProgrammingStatus;
  supplierName: string;
};

export type DashboardWeekDay = {
  date: string;
  label: string;
  shortLabel: string;
  programmingCount: number;
  programmedM3: number;
  isToday: boolean;
};

export type DashboardIncident = {
  id: string;
  createdAt: string;
  typeName: string;
  responsibility: string;
  notes: string | null;
};

export type DashboardBatch = {
  id: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  accountingPeriod: string;
  status: BatchStatus;
  activeGuideCount: number;
  pendingInvoiceCount: number;
  reinvoicingCount: number;
  pendingAuthorizationCount: number;
};

export type DashboardActivity = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actorName: string;
};

export type ProjectDashboardData = {
  today: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  programmingToday: DashboardProgramming[];
  weekDays: DashboardWeekDay[];
  metrics: {
    programmingTodayCount: number;
    programmingWeekCount: number;
    dispatchTodayCount: number;
    programmedTodayM3: number;
    dispatchedTodayM3: number;
    pendingInvoiceCount: number;
    reinvoicingCount: number;
    openDiscrepancyCount: number;
    pendingReviewBatchCount: number;
    pendingAuthorizationBatchCount: number;
  };
  incidents: DashboardIncident[];
  currentBatch: DashboardBatch | null;
  activity: DashboardActivity[];
};
