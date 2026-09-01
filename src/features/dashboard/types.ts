export type ProgrammingStatus = "DRAFT" | "PENDING_CONFIRMATION" | "CONFIRMED" | "IN_EXECUTION" | "COMPLETED" | "CANCELLED";
export type BatchStatus = "DRAFT" | "ASSEMBLING" | "READY_FOR_REVIEW" | "UNDER_REVIEW" | "NEEDS_CORRECTION" | "VALIDATED" | "PENDING_FINAL_AUTHORIZATION" | "AUTHORIZED" | "CLOSED" | "CANCELLED";
export type DashboardWeekDay = { date: string; shortLabel: string; programmingCount: number; programmedM3: number; receivedM3: number; isToday: boolean };
export type DashboardActivity = { id: string; action: string; entityType: string; entityId: string; createdAt: string; actorName: string };
export type DashboardBatch = { id: string; code: string; periodStart: string; periodEnd: string; accountingPeriod: string; status: BatchStatus; activeGuideCount: number };
export type ProjectDashboardData = {
  today: string; weekStart: string; weekEnd: string; timezone: string; weekDays: DashboardWeekDay[]; currentBatch: DashboardBatch | null; activity: DashboardActivity[];
  metrics: {
    today: { total: number; completed: number; pending: number; programmedM3: number };
    week: { total: number; completed: number; pending: number; compliance: number };
    month: { programmedM3: number; receivedM3: number; execution: number };
    orders: { pending: number; completed: number; reinvoicing: number };
    reconciliation: { matched: number; differences: number; withoutInvoice: number };
    attention: { reinvoicing: number; overdueProgramming: number; pendingInvoice: number; differences: number };
  };
};
