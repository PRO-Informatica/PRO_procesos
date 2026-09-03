import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  CompanyDetail,
  CompanyListFilters,
  CompanyListItem,
  CompanyListResult,
  CompanyProject,
  CompanySupplier,
  CompanyStatus,
  CompanyUser,
} from "./types";

type CompanyRow = {
  id: string;
  name: string;
  code: string;
  status: CompanyStatus;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  address: string | null;
  status: string;
  timezone: string | null;
  start_date: string | null;
  estimated_end_date: string | null;
};

type MembershipRow = {
  id: string;
  company_id: string;
  user_id: string;
  active: boolean;
  created_at: string;
};

type RoleAssignmentRow = {
  company_member_id: string;
  role_id: string;
};

type RoleRow = {
  id: string;
  code: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

type SupplierRow = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

type ProjectSupplierRow = {
  project_id: string;
  supplier_id: string;
  active: boolean;
};

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function safeSearchTerm(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function profileLabel(profile: ProfileRow | undefined, userId: string) {
  return profile?.full_name?.trim() || `Usuario ${userId.slice(0, 8)}`;
}

async function getCompanyListMetadata(companyIds: string[]) {
  if (companyIds.length === 0) {
    return {
      projectCounts: new Map<string, number>(),
      userCounts: new Map<string, number>(),
      adminsByCompany: new Map<string, string[]>(),
    };
  }

  const supabase = await createClient();
  const [projectsResult, membershipsResult] = await Promise.all([
    supabase.from("projects").select("company_id").in("company_id", companyIds),
    supabase
      .from("company_members")
      .select("id, company_id, user_id, active, created_at")
      .in("company_id", companyIds)
      .eq("active", true),
  ]);

  if (projectsResult.error || membershipsResult.error) {
    throw new Error("No fue posible cargar los indicadores de las empresas.");
  }

  const projectCounts = new Map<string, number>();
  for (const project of projectsResult.data ?? []) {
    incrementCount(projectCounts, project.company_id as string);
  }

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const userCounts = new Map<string, number>();
  for (const membership of memberships) {
    incrementCount(userCounts, membership.company_id);
  }

  const membershipIds = memberships.map((membership) => membership.id);
  if (membershipIds.length === 0) {
    return { projectCounts, userCounts, adminsByCompany: new Map<string, string[]>() };
  }

  const { data: assignmentsData, error: assignmentsError } = await supabase
    .from("company_member_roles")
    .select("company_member_id, role_id")
    .in("company_member_id", membershipIds)
    .is("revoked_at", null);

  if (assignmentsError) {
    throw new Error("No fue posible cargar los administradores de empresa.");
  }

  const assignments = (assignmentsData ?? []) as RoleAssignmentRow[];
  const roleIds = [...new Set(assignments.map((assignment) => assignment.role_id))];
  if (roleIds.length === 0) {
    return { projectCounts, userCounts, adminsByCompany: new Map<string, string[]>() };
  }

  const { data: rolesData, error: rolesError } = await supabase
    .from("roles")
    .select("id, code")
    .in("id", roleIds)
    .eq("code", "COMPANY_ADMIN")
    .eq("active", true);

  if (rolesError) {
    throw new Error("No fue posible verificar los administradores de empresa.");
  }

  const adminRoleIds = new Set((rolesData ?? []).map((role) => role.id as string));
  const adminMembershipIds = new Set(
    assignments
      .filter((assignment) => adminRoleIds.has(assignment.role_id))
      .map((assignment) => assignment.company_member_id),
  );
  const adminMemberships = memberships.filter((membership) =>
    adminMembershipIds.has(membership.id),
  );
  const adminUserIds = [...new Set(adminMemberships.map((membership) => membership.user_id))];

  const profilesResult = adminUserIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", adminUserIds)
    : { data: [], error: null };

  if (profilesResult.error) {
    throw new Error("No fue posible cargar los perfiles administradores.");
  }

  const profiles = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );
  const adminsByCompany = new Map<string, string[]>();

  for (const membership of adminMemberships) {
    const current = adminsByCompany.get(membership.company_id) ?? [];
    current.push(profileLabel(profiles.get(membership.user_id), membership.user_id));
    adminsByCompany.set(membership.company_id, [...new Set(current)]);
  }

  return { projectCounts, userCounts, adminsByCompany };
}

export async function getCompanies(
  filters: CompanyListFilters,
): Promise<CompanyListResult> {
  const supabase = await createClient();
  const queryTerm = safeSearchTerm(filters.query);
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let query = supabase
    .from("companies")
    .select("id, name, code, status, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }

  if (queryTerm) {
    query = query.or(`name.ilike.%${queryTerm}%,code.ilike.%${queryTerm}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error("No fue posible consultar el listado de empresas.");
  }

  const rows = (data ?? []) as CompanyRow[];
  const metadata = await getCompanyListMetadata(rows.map((company) => company.id));
  const items: CompanyListItem[] = rows.map((company) => ({
    id: company.id,
    name: company.name,
    code: company.code,
    status: company.status,
    createdAt: company.created_at,
    projectCount: metadata.projectCounts.get(company.id) ?? 0,
    activeUserCount: metadata.userCounts.get(company.id) ?? 0,
    companyAdmins: metadata.adminsByCompany.get(company.id) ?? [],
  }));
  const total = count ?? 0;

  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

export async function getCompanyDetail(companyId: string): Promise<CompanyDetail | null> {
  const supabase = await createClient();
  const { data: companyData, error: companyError } = await supabase
    .from("companies")
    .select("id, name, code, status, created_at, updated_at")
    .eq("id", companyId)
    .maybeSingle<CompanyRow>();

  if (companyError) {
    throw new Error("No fue posible consultar la empresa.");
  }

  if (!companyData) return null;

  const [projectsResult, membershipsResult, suppliersResult, projectSuppliersResult] =
    await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, company_id, name, code, address, status, timezone, start_date, estimated_end_date",
      )
      .eq("company_id", companyId)
      .order("name"),
    supabase
      .from("company_members")
      .select("id, company_id, user_id, active, created_at")
      .eq("company_id", companyId)
      .order("created_at"),
    supabase
      .from("suppliers")
      .select("id, code, name, active")
      .eq("company_id", companyId)
      .order("name"),
    supabase
      .from("project_suppliers")
      .select("project_id, supplier_id, active")
      .eq("company_id", companyId),
  ]);

  if (
    projectsResult.error ||
    membershipsResult.error ||
    suppliersResult.error ||
    projectSuppliersResult.error
  ) {
    throw new Error("No fue posible cargar las relaciones de la empresa.");
  }

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const membershipIds = memberships.map((membership) => membership.id);
  const userIds = [...new Set(memberships.map((membership) => membership.user_id))];

  const [assignmentsResult, profilesResult] = await Promise.all([
    membershipIds.length
      ? supabase
          .from("company_member_roles")
          .select("company_member_id, role_id")
          .in("company_member_id", membershipIds)
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (assignmentsResult.error || profilesResult.error) {
    throw new Error("No fue posible cargar los usuarios de la empresa.");
  }

  const assignments = (assignmentsResult.data ?? []) as RoleAssignmentRow[];
  const roleIds = [...new Set(assignments.map((assignment) => assignment.role_id))];
  const rolesResult = roleIds.length
    ? await supabase
        .from("roles")
        .select("id, code")
        .in("id", roleIds)
        .eq("active", true)
    : { data: [], error: null };

  if (rolesResult.error) {
    throw new Error("No fue posible cargar los roles de compañía.");
  }

  const profiles = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );
  const roles = new Map(
    ((rolesResult.data ?? []) as RoleRow[]).map((role) => [role.id, role.code]),
  );
  const roleCodesByMembership = new Map<string, string[]>();

  for (const assignment of assignments) {
    const roleCode = roles.get(assignment.role_id);
    if (!roleCode) continue;
    const current = roleCodesByMembership.get(assignment.company_member_id) ?? [];
    current.push(roleCode);
    roleCodesByMembership.set(assignment.company_member_id, [...new Set(current)]);
  }

  const users: CompanyUser[] = memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.user_id,
    name: profileLabel(profiles.get(membership.user_id), membership.user_id),
    active: membership.active,
    roles: roleCodesByMembership.get(membership.id) ?? [],
    createdAt: membership.created_at,
  }));
  const activeSupplierIdsByProject = new Map<string, string[]>();
  for (const relation of (projectSuppliersResult.data ?? []) as ProjectSupplierRow[]) {
    if (!relation.active) continue;
    const current = activeSupplierIdsByProject.get(relation.project_id) ?? [];
    current.push(relation.supplier_id);
    activeSupplierIdsByProject.set(relation.project_id, current);
  }
  const projects: CompanyProject[] = ((projectsResult.data ?? []) as ProjectRow[]).map(
    (project) => ({
      id: project.id,
      name: project.name,
      code: project.code,
      address: project.address,
      status: project.status,
      timezone: project.timezone ?? "America/Guatemala",
      startDate: project.start_date,
      estimatedEndDate: project.estimated_end_date,
      supplierIds: activeSupplierIdsByProject.get(project.id) ?? [],
    }),
  );
  const suppliers: CompanySupplier[] = ((suppliersResult.data ?? []) as SupplierRow[]).map(
    (supplier) => ({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      active: supplier.active,
    }),
  );

  return {
    id: companyData.id,
    name: companyData.name,
    code: companyData.code,
    status: companyData.status,
    createdAt: companyData.created_at,
    updatedAt: companyData.updated_at,
    projects,
    suppliers,
    users,
    companyAdmins: users
      .filter((user) => user.active && user.roles.includes("COMPANY_ADMIN"))
      .map((user) => user.name),
  };
}
