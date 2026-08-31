import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  BatchStatus,
  DashboardActivity,
  DashboardBatch,
  DashboardIncident,
  DashboardProgramming,
  DashboardWeekDay,
  ProgrammingStatus,
  ProjectDashboardData,
} from "./types";

const DEFAULT_TIMEZONE = "America/Guatemala";
const PENDING_INVOICE_STATUSES = ["REGISTERED", "MATCHED", "UNDER_REVIEW"];
const REVIEW_BATCH_STATUSES = ["READY_FOR_REVIEW", "UNDER_REVIEW"];

type ProgrammingRow = {
  id: string;
  supplier_id: string;
  scheduled_at: string;
  requested_quantity: number | string;
  confirmed_quantity: number | string | null;
  unit_code: string;
  status: ProgrammingStatus;
};

type ProjectSupplierRow = {
  supplier_id: string;
  suppliers: { name: string } | Array<{ name: string }> | null;
};

type GuideRow = {
  dispatch_id: string;
  quantity: number | string;
  unit_code: string;
};

type IncidentRow = {
  id: string;
  created_at: string;
  responsibility: string;
  notes: string | null;
  incident_types:
    | { name: string; code: string }
    | Array<{ name: string; code: string }>
    | null;
};

type BatchGuideRow = {
  id: string;
  guide_id: string;
  removed_at: string | null;
};

type BatchRow = {
  id: string;
  code: string;
  period_start: string;
  period_end: string;
  accounting_period: string;
  status: BatchStatus;
  batch_guides: BatchGuideRow[] | null;
};

type GuideInvoiceRow = {
  invoice_id: string;
  invoices:
    | { status: string; project_id: string }
    | Array<{ status: string; project_id: string }>
    | null;
};

type ActivityRow = {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
  actor_user_id: string | null;
  profiles: { full_name: string | null } | Array<{ full_name: string | null }> | null;
};

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function dateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDateDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return addDateDays(value, -(weekday === 0 ? 6 : weekday - 1));
}

function zonedMidnightIso(value: string, timezone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = desired;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).formatToParts(new Date(guess));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    guess += desired - represented;
  }

  return new Date(guess).toISOString();
}

function localDateKey(value: string, timezone: string) {
  const parts = dateParts(new Date(value), timezone);
  return dateKey(parts.year, parts.month, parts.day);
}

function numeric(value: number | string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function programmingQuantity(row: ProgrammingRow) {
  return numeric(row.confirmed_quantity ?? row.requested_quantity);
}

function assertResults(
  results: Array<{ error: { message: string } | null }>,
  message: string,
) {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`${message} ${failed.error.message}`);
}

export async function getProjectDashboard(
  projectId: string,
  projectTimezone: string | null,
): Promise<ProjectDashboardData> {
  const supabase = await createClient();
  const timezone = projectTimezone || DEFAULT_TIMEZONE;
  const now = new Date();
  const localTodayParts = dateParts(now, timezone);
  const today = dateKey(localTodayParts.year, localTodayParts.month, localTodayParts.day);
  const weekStart = startOfWeek(today);
  const weekEnd = addDateDays(weekStart, 6);
  const nextWeek = addDateDays(weekEnd, 1);
  const weekStartIso = zonedMidnightIso(weekStart, timezone);
  const nextWeekIso = zonedMidnightIso(nextWeek, timezone);

  const [
    programmingResult,
    guidesResult,
    incidentsResult,
    batchResult,
    pendingInvoicesResult,
    reinvoicingResult,
    discrepanciesResult,
    reviewBatchesResult,
    authorizationBatchesResult,
    activityResult,
  ] = await Promise.all([
    supabase
      .from("programming")
      .select(
        "id, supplier_id, scheduled_at, requested_quantity, confirmed_quantity, unit_code, status",
      )
      .eq("project_id", projectId)
      .gte("scheduled_at", weekStartIso)
      .lt("scheduled_at", nextWeekIso)
      .order("scheduled_at"),
    supabase
      .from("dispatch_guides")
      .select("dispatch_id, quantity, unit_code")
      .eq("project_id", projectId)
      .eq("guide_date", today),
    supabase
      .from("dispatch_incidents")
      .select("id, created_at, responsibility, notes, incident_types(code, name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("batches")
      .select(
        "id, code, period_start, period_end, accounting_period, status, batch_guides!batch_guides_batch_project_fk(id, guide_id, removed_at)",
      )
      .eq("project_id", projectId)
      .lte("period_start", today)
      .gte("period_end", today)
      .neq("status", "CANCELLED")
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("status", PENDING_INVOICE_STATUSES),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "REINVOICING"),
    supabase
      .from("invoice_discrepancies")
      .select("id, invoice_reviews!inner(project_id)", { count: "exact", head: true })
      .eq("resolved", false)
      .eq("invoice_reviews.project_id", projectId),
    supabase
      .from("batches")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("status", REVIEW_BATCH_STATUSES),
    supabase
      .from("batches")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "PENDING_FINAL_AUTHORIZATION"),
    supabase
      .from("audit_events")
      .select("id, action, entity_type, created_at, actor_user_id, profiles(full_name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  assertResults(
    [
      programmingResult,
      guidesResult,
      incidentsResult,
      batchResult,
      pendingInvoicesResult,
      reinvoicingResult,
      discrepanciesResult,
      reviewBatchesResult,
      authorizationBatchesResult,
      activityResult,
    ],
    "No fue posible cargar el dashboard del proyecto.",
  );

  const programmingRows = (programmingResult.data ?? []) as ProgrammingRow[];
  const supplierIds = [...new Set(programmingRows.map((row) => row.supplier_id))];
  const currentBatchRow = (batchResult.data ?? null) as BatchRow | null;
  const activeBatchGuides = (currentBatchRow?.batch_guides ?? []).filter(
    (guide) => guide.removed_at === null,
  );
  const activeGuideIds = activeBatchGuides.map((guide) => guide.guide_id);

  const [projectSuppliersResult, batchInvoicesResult] = await Promise.all([
    supplierIds.length
      ? supabase
          .from("project_suppliers")
          .select("supplier_id, suppliers(name)")
          .eq("project_id", projectId)
          .in("supplier_id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
    activeGuideIds.length
      ? supabase
          .from("guide_invoices")
          .select("invoice_id, invoices!inner(status, project_id)")
          .eq("project_id", projectId)
          .in("guide_id", activeGuideIds)
          .eq("invoices.project_id", projectId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  assertResults(
    [projectSuppliersResult, batchInvoicesResult],
    "No fue posible resolver el contexto relacionado del dashboard.",
  );

  const supplierMap = new Map(
    ((projectSuppliersResult.data ?? []) as ProjectSupplierRow[]).map((row) => [
      row.supplier_id,
      firstRelation(row.suppliers)?.name ?? "Proveedor no disponible",
    ]),
  );
  const programming: DashboardProgramming[] = programmingRows.map((row) => ({
    id: row.id,
    scheduledAt: row.scheduled_at,
    quantity: programmingQuantity(row),
    unitCode: row.unit_code,
    status: row.status,
    supplierName: supplierMap.get(row.supplier_id) ?? "Proveedor no disponible",
  }));
  const programmingToday = programming.filter(
    (item) => localDateKey(item.scheduledAt, timezone) === today,
  );

  const weekDays: DashboardWeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDateDays(weekStart, index);
    const dayProgramming = programming.filter(
      (item) => localDateKey(item.scheduledAt, timezone) === date,
    );
    const dayName = new Intl.DateTimeFormat("es-GT", {
      weekday: "short",
      timeZone: timezone,
    })
      .format(new Date(`${date}T12:00:00Z`))
      .replace(".", "");
    const dayNumber = Number(date.slice(-2));

    return {
      date,
      label: `${dayName} ${dayNumber}`,
      shortLabel: dayName.slice(0, 3),
      programmingCount: dayProgramming.length,
      programmedM3: dayProgramming
        .filter((item) => item.unitCode === "M3" && item.status !== "CANCELLED")
        .reduce((sum, item) => sum + item.quantity, 0),
      isToday: date === today,
    };
  });

  const guides = (guidesResult.data ?? []) as GuideRow[];
  const incidents: DashboardIncident[] = ((incidentsResult.data ?? []) as IncidentRow[]).map(
    (row) => ({
      id: row.id,
      createdAt: row.created_at,
      typeName: firstRelation(row.incident_types)?.name ?? "Incidencia",
      responsibility: row.responsibility,
      notes: row.notes,
    }),
  );
  const activities: DashboardActivity[] = ((activityResult.data ?? []) as ActivityRow[]).map(
    (row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      createdAt: row.created_at,
      actorName: row.actor_user_id
        ? firstRelation(row.profiles)?.full_name?.trim() || "Usuario no disponible"
        : "Sistema",
    }),
  );

  const batchInvoiceRows = (batchInvoicesResult.data ?? []) as GuideInvoiceRow[];
  const batchInvoiceStatusById = new Map<string, string>();
  for (const row of batchInvoiceRows) {
    const invoice = firstRelation(row.invoices);
    if (invoice?.project_id === projectId) batchInvoiceStatusById.set(row.invoice_id, invoice.status);
  }
  const batchStatuses = [...batchInvoiceStatusById.values()];
  const currentBatch: DashboardBatch | null = currentBatchRow
    ? {
        id: currentBatchRow.id,
        code: currentBatchRow.code,
        periodStart: currentBatchRow.period_start,
        periodEnd: currentBatchRow.period_end,
        accountingPeriod: currentBatchRow.accounting_period,
        status: currentBatchRow.status,
        activeGuideCount: activeBatchGuides.length,
        pendingInvoiceCount: batchStatuses.filter((status) =>
          PENDING_INVOICE_STATUSES.includes(status),
        ).length,
        reinvoicingCount: batchStatuses.filter((status) => status === "REINVOICING").length,
        pendingAuthorizationCount:
          currentBatchRow.status === "PENDING_FINAL_AUTHORIZATION" ? 1 : 0,
      }
    : null;

  return {
    today,
    weekStart,
    weekEnd,
    timezone,
    programmingToday,
    weekDays,
    metrics: {
      programmingTodayCount: programmingToday.length,
      programmingWeekCount: programming.length,
      dispatchTodayCount: new Set(guides.map((guide) => guide.dispatch_id)).size,
      programmedTodayM3: programmingToday
        .filter((item) => item.unitCode === "M3" && item.status !== "CANCELLED")
        .reduce((sum, item) => sum + item.quantity, 0),
      dispatchedTodayM3: guides
        .filter((guide) => guide.unit_code === "M3")
        .reduce((sum, guide) => sum + numeric(guide.quantity), 0),
      pendingInvoiceCount: pendingInvoicesResult.count ?? 0,
      reinvoicingCount: reinvoicingResult.count ?? 0,
      openDiscrepancyCount: discrepanciesResult.count ?? 0,
      pendingReviewBatchCount: reviewBatchesResult.count ?? 0,
      pendingAuthorizationBatchCount: authorizationBatchesResult.count ?? 0,
    },
    incidents,
    currentBatch,
    activity: activities,
  };
}
