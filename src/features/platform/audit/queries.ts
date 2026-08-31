import "server-only";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createClient } from "@/lib/supabase/server";

import type {
  AuditEventItem,
  AuditFilters,
  AuditListResult,
} from "./types";

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  company_id: string | null;
  project_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  created_at: string;
};

type AuditOptionRow = {
  actor_user_id: string | null;
  action: string;
  entity_type: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
};

type ProjectRow = {
  id: string;
  name: string;
};

function nextDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function startOfGuatemalaDate(value: string) {
  return `${value}T00:00:00-06:00`;
}

async function requirePlatformAuditContext() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || !userId || !(await isPlatformAdmin(userId))) {
    throw new Error("No tienes autorización para consultar la auditoría global.");
  }

  return supabase;
}

export async function getGlobalAudit(filters: AuditFilters): Promise<AuditListResult> {
  const supabase = await requirePlatformAuditContext();
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let eventsQuery = supabase
    .from("audit_events")
    .select(
      "id, actor_user_id, company_id, project_id, entity_type, entity_id, action, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.actorId) eventsQuery = eventsQuery.eq("actor_user_id", filters.actorId);
  if (filters.action) eventsQuery = eventsQuery.eq("action", filters.action);
  if (filters.companyId) eventsQuery = eventsQuery.eq("company_id", filters.companyId);
  if (filters.entityType) eventsQuery = eventsQuery.eq("entity_type", filters.entityType);
  if (filters.fromDate) {
    eventsQuery = eventsQuery.gte("created_at", startOfGuatemalaDate(filters.fromDate));
  }
  if (filters.toDate) {
    eventsQuery = eventsQuery.lt(
      "created_at",
      startOfGuatemalaDate(nextDate(filters.toDate)),
    );
  }

  const [eventsResult, optionRowsResult, companiesResult] = await Promise.all([
    eventsQuery,
    supabase
      .from("audit_events")
      .select("actor_user_id, action, entity_type")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("companies").select("id, name").order("name"),
  ]);

  if (eventsResult.error || optionRowsResult.error || companiesResult.error) {
    throw new Error("No fue posible consultar los eventos globales de auditoría.");
  }

  const rows = (eventsResult.data ?? []) as AuditRow[];
  const optionRows = (optionRowsResult.data ?? []) as AuditOptionRow[];
  const companies = (companiesResult.data ?? []) as CompanyRow[];
  const actorIds = [
    ...new Set(
      [...rows, ...optionRows]
        .map((row) => row.actor_user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const projectIds = [
    ...new Set(rows.map((row) => row.project_id).filter((value): value is string => Boolean(value))),
  ];

  const [profilesResult, projectsResult] = await Promise.all([
    actorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error || projectsResult.error) {
    throw new Error("No fue posible resolver el contexto de los eventos de auditoría.");
  }

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const total = eventsResult.count ?? 0;
  const items: AuditEventItem[] = rows.map((row) => {
    const profile = row.actor_user_id ? profileMap.get(row.actor_user_id) : null;

    return {
      id: row.id,
      actorId: row.actor_user_id,
      actorName: row.actor_user_id
        ? profile?.full_name?.trim() || "Usuario no disponible"
        : "Sistema",
      action: row.action,
      companyId: row.company_id,
      companyName: row.company_id ? companyMap.get(row.company_id)?.name ?? null : null,
      projectId: row.project_id,
      projectName: row.project_id ? projectMap.get(row.project_id)?.name ?? null : null,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at,
    };
  });

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    options: {
      actors: actorIds
        .map((id) => ({
          value: id,
          label: profileMap.get(id)?.full_name?.trim() || "Usuario no disponible",
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "es-GT")),
      actions: [...new Set(optionRows.map((row) => row.action))].sort(),
      companies: companies.map((company) => ({ value: company.id, label: company.name })),
      entityTypes: [...new Set(optionRows.map((row) => row.entity_type))].sort(),
    },
  };
}
