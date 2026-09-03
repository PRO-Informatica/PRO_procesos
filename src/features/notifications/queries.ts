import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OperationalNotification } from "./types";

export async function getOperationalNotifications(input: { projectId: string; projectName: string; userId: string; permissions: string[] }): Promise<OperationalNotification[]> {
  const supabase = await createClient(); const now = new Date(); const future = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(); const past = new Date(now.getTime() - 30 * 86400000).toISOString();
  const canProgramming = input.permissions.includes("programming.view"); const canInvoices = input.permissions.includes("invoice.view") && input.permissions.includes("batch.view"); const canDispatch = input.permissions.includes("dispatch.view"); const canDocuments = input.permissions.includes("document.view");
  const [upcoming, overdue, orders, incidents, pendingDocs, reads] = await Promise.all([
    canProgramming ? supabase.from("programming").select("id, scheduled_at, status").eq("project_id", input.projectId).in("status", ["PENDING_CONFIRMATION", "CONFIRMED"]).gte("scheduled_at", now.toISOString()).lte("scheduled_at", future).order("scheduled_at").limit(20) : Promise.resolve({ data: [], error: null }),
    canProgramming ? supabase.from("programming").select("id, scheduled_at, status").eq("project_id", input.projectId).in("status", ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "IN_EXECUTION"]).lt("scheduled_at", now.toISOString()).order("scheduled_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    canInvoices ? supabase.from("dispatch_reconciliations").select("id, dispatch_id, status, updated_at").eq("project_id", input.projectId).in("status", ["PENDING_INVOICES", "WITH_DIFFERENCES", "PENDING_REINVOICING"]).order("updated_at", { ascending: false }).limit(40) : Promise.resolve({ data: [], error: null }),
    canDispatch ? supabase.from("dispatch_incidents").select("id, dispatch_id, notes, created_at").eq("project_id", input.projectId).gte("created_at", past).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    canDocuments ? supabase.from("document_versions").select("id, document_id, created_at").eq("upload_status", "PENDING").gte("created_at", past).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    supabase.from("notification_reads").select("notification_key, read_at").eq("project_id", input.projectId).eq("user_id", input.userId),
  ]);
  const error = upcoming.error ?? overdue.error ?? orders.error ?? incidents.error ?? pendingDocs.error ?? reads.error;
  if (error) throw new Error(`No fue posible cargar Notificaciones. ${error.message}`);
  const result: OperationalNotification[] = [];
  const push = (notification: Omit<OperationalNotification, "projectId" | "projectName" | "read">) => result.push({ ...notification, projectId: input.projectId, projectName: input.projectName, read: false });
  for (const row of upcoming.data ?? []) push({ key: `programming-upcoming:${row.id}`, title: "Programación próxima", description: "Esta programación inicia dentro de las próximas 48 horas.", createdAt: row.scheduled_at, type: "PROGRAMMING", href: `/programming/${row.id}` });
  for (const row of overdue.data ?? []) push({ key: `programming-overdue:${row.id}`, title: "Programación vencida", description: "La fecha programada ya pasó y el proceso todavía no está completado.", createdAt: row.scheduled_at, type: "PROGRAMMING", href: `/programming/${row.id}` });
  for (const row of orders.data ?? []) {
    const difference = ["WITH_DIFFERENCES", "PENDING_REINVOICING"].includes(row.status);
    push({ key: `dispatch-reconciliation:${row.id}:${row.status}`, title: difference ? "Despacho con diferencias" : "Despacho pendiente de facturas", description: difference ? "La conciliación del despacho requiere revisión o refacturación." : "El despacho todavía no tiene ambas facturas requeridas.", createdAt: row.updated_at, type: difference ? "RECONCILIATION" : "INVOICE", href: `/dispatches/${row.dispatch_id}` });
  }
  for (const row of incidents.data ?? []) push({ key: `incident:${row.id}`, title: "Incidencia registrada", description: row.notes?.trim() || "Se registró una incidencia que requiere seguimiento.", createdAt: row.created_at, type: "INCIDENT", href: `/dispatches/${row.dispatch_id}` });
  for (const row of pendingDocs.data ?? []) push({ key: `document-pending:${row.id}`, title: "Documento pendiente", description: "Una carga documental quedó pendiente de completar.", createdAt: row.created_at, type: "DOCUMENT", href: "/documents" });
  const readMap = new Map((reads.data ?? []).map((row) => [row.notification_key, row.read_at])); const allRead = readMap.get("__ALL__");
  return result.map((item) => ({ ...item, read: readMap.has(item.key) || Boolean(allRead && new Date(item.createdAt) <= new Date(allRead)) })).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function getUnreadNotificationCount(input: Parameters<typeof getOperationalNotifications>[0]) { return (await getOperationalNotifications(input)).filter((item) => !item.read).length; }
