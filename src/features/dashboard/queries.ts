import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BatchStatus, DashboardActivity, DashboardBatch, DashboardWeekDay, ProgrammingStatus, ProjectDashboardData } from "./types";

const DEFAULT_TIMEZONE = "America/Guatemala";
type ProgrammingRow = { id: string; scheduled_at: string; requested_quantity: number | string; confirmed_quantity: number | string | null; unit_code: string; status: ProgrammingStatus };
function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function quantity(row: ProgrammingRow) { return numeric(row.confirmed_quantity ?? row.requested_quantity); }
function parts(value: Date, timezone: string) { const result = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(value); const get = (type: Intl.DateTimeFormatPartTypes) => Number(result.find((p) => p.type === type)?.value); return { year: get("year"), month: get("month"), day: get("day") }; }
function key(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function add(value: string, days: number) { const [y, m, d] = value.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10); }
function weekStart(value: string) { const [y, m, d] = value.split("-").map(Number); const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); return add(value, -(weekday === 0 ? 6 : weekday - 1)); }
function zonedDate(value: string, timezone: string) { const p = parts(new Date(value), timezone); return key(p.year, p.month, p.day); }
function percent(value: number, total: number) { return total > 0 ? Math.min(Math.round((value / total) * 100), 100) : 0; }

export async function getProjectDashboard(projectId: string, projectTimezone: string | null): Promise<ProjectDashboardData> {
  const supabase = await createClient(); const timezone = projectTimezone || DEFAULT_TIMEZONE; const now = new Date(); const p = parts(now, timezone); const today = key(p.year, p.month, p.day); const start = weekStart(today); const end = add(start, 6); const monthStart = key(p.year, p.month, 1); const nextMonth = key(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 1 : p.month + 1, 1);
  const [programmingResult, guidesResult, ordersResult, batchResult, activityResult] = await Promise.all([
    supabase.from("programming").select("id, scheduled_at, requested_quantity, confirmed_quantity, unit_code, status").eq("project_id", projectId).gte("scheduled_at", `${monthStart}T00:00:00`).lt("scheduled_at", `${nextMonth}T00:00:00`).order("scheduled_at"),
    supabase.from("dispatch_guides").select("id, guide_date, quantity, unit_code").eq("project_id", projectId).gte("guide_date", monthStart).lt("guide_date", nextMonth),
    supabase.from("reconciliation_orders").select("id, reconciliation_status").eq("project_id", projectId).limit(2000),
    supabase.from("batches").select("id, code, period_start, period_end, accounting_period, status, batch_guides!batch_guides_batch_project_fk(id, removed_at)").eq("project_id", projectId).lte("period_start", today).gte("period_end", today).neq("status", "CANCELLED").limit(1).maybeSingle(),
    supabase.from("audit_events").select("id, action, entity_type, entity_id, created_at, actor_user_id, profiles(full_name)").eq("project_id", projectId).order("created_at", { ascending: false }).limit(8),
  ]);
  const error = programmingResult.error ?? guidesResult.error ?? ordersResult.error ?? batchResult.error ?? activityResult.error;
  if (error) throw new Error(`No fue posible cargar el Dashboard. ${error.message}`);
  const programming = (programmingResult.data ?? []) as ProgrammingRow[]; const guides = guidesResult.data ?? []; const orders = ordersResult.data ?? [];
  const weekProgramming = programming.filter((row) => { const date = zonedDate(row.scheduled_at, timezone); return date >= start && date <= end && row.status !== "CANCELLED"; });
  const todayProgramming = weekProgramming.filter((row) => zonedDate(row.scheduled_at, timezone) === today);
  const completedWeek = weekProgramming.filter((row) => row.status === "COMPLETED").length;
  const programmedMonth = programming.filter((row) => row.unit_code === "M3" && row.status !== "CANCELLED").reduce((sum, row) => sum + quantity(row), 0);
  const receivedMonth = guides.filter((row) => row.unit_code === "M3").reduce((sum, row) => sum + numeric(row.quantity), 0);
  const weekDays: DashboardWeekDay[] = Array.from({ length: 7 }, (_, index) => { const date = add(start, index); const dayPrograms = weekProgramming.filter((row) => zonedDate(row.scheduled_at, timezone) === date); const dayGuides = guides.filter((row) => row.guide_date === date && row.unit_code === "M3"); const shortLabel = new Intl.DateTimeFormat("es-GT", { weekday: "short", timeZone: timezone }).format(new Date(`${date}T12:00:00Z`)).replace(".", "").slice(0, 3); return { date, shortLabel, programmingCount: dayPrograms.length, programmedM3: dayPrograms.filter((row) => row.unit_code === "M3").reduce((sum, row) => sum + quantity(row), 0), receivedM3: dayGuides.reduce((sum, row) => sum + numeric(row.quantity), 0), isToday: date === today }; });
  const matched = orders.filter((row) => row.reconciliation_status === "MATCHED").length; const noInvoice = orders.filter((row) => row.reconciliation_status === "NO_INVOICES").length; const differences = orders.filter((row) => ["PARTIAL", "WITH_DIFFERENCES", "REQUIRES_REVIEW"].includes(row.reconciliation_status)).length;
  const activity: DashboardActivity[] = (activityResult.data ?? []).map((row) => { const relation = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; return { id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, createdAt: row.created_at, actorName: relation?.full_name?.trim() || (row.actor_user_id ? "Usuario no disponible" : "Sistema") }; });
  const current = batchResult.data as null | { id: string; code: string; period_start: string; period_end: string; accounting_period: string; status: BatchStatus; batch_guides: Array<{ removed_at: string | null }> | null };
  const currentBatch: DashboardBatch | null = current ? { id: current.id, code: current.code, periodStart: current.period_start, periodEnd: current.period_end, accountingPeriod: current.accounting_period, status: current.status, activeGuideCount: (current.batch_guides ?? []).filter((row) => row.removed_at === null).length } : null;
  const overdueProgramming = programming.filter((row) => zonedDate(row.scheduled_at, timezone) < today && !["COMPLETED", "CANCELLED"].includes(row.status)).length;
  return { today, weekStart: start, weekEnd: end, timezone, weekDays, currentBatch, activity, metrics: { today: { total: todayProgramming.length, completed: todayProgramming.filter((row) => row.status === "COMPLETED").length, pending: todayProgramming.filter((row) => !["COMPLETED", "CANCELLED"].includes(row.status)).length, programmedM3: todayProgramming.filter((row) => row.unit_code === "M3").reduce((sum, row) => sum + quantity(row), 0) }, week: { total: weekProgramming.length, completed: completedWeek, pending: weekProgramming.length - completedWeek, compliance: percent(completedWeek, weekProgramming.length) }, month: { programmedM3: programmedMonth, receivedM3: receivedMonth, execution: percent(receivedMonth, programmedMonth) }, orders: { pending: orders.length - matched - differences, completed: matched, reinvoicing: differences }, reconciliation: { matched, differences, withoutInvoice: noInvoice }, attention: { reinvoicing: differences, overdueProgramming, pendingInvoice: noInvoice, differences } } };
}
