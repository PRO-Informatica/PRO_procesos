import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { projectCalendarDate, weeklyBatchPeriods } from "./period-policy";
import type { OverdueBatchAlerts } from "./types";

/** Request-scoped sharing between the notification badge and the batch page.
 * Uses the user's client/RLS, never a service-role client or a persistent cache.
 */
export const getOverdueBatchAlerts = cache(async (projectId: string, timezone: string): Promise<OverdueBatchAlerts> => {
  const monday = weeklyBatchPeriods(projectCalendarDate(timezone))[0].start;
  const result = await (await createClient()).from("batches")
    .select("id, code, period_start, period_end, created_at", { count: "exact" })
    .eq("project_id", projectId).eq("status", "OPEN")
    .lt("period_start", monday).order("period_start").limit(20);
  if (result.error) throw new Error("No fue posible consultar los lotes pendientes de cierre.");
  return {
    total: result.count ?? 0,
    batches: (result.data ?? []).map((row) => ({ id: row.id, code: row.code, periodStart: row.period_start, periodEnd: row.period_end, createdAt: row.created_at })),
  };
});
