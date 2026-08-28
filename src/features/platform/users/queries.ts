import "server-only";

import type { User } from "@supabase/supabase-js";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

import type {
  PlatformCompanyOption,
  PlatformProjectOption,
  PlatformRoleOption,
  PlatformUserAuthStatus,
  PlatformUserDetail,
  PlatformUserListFilters,
  PlatformUserListItem,
  PlatformUserListResult,
  UserCompanyMembership,
  UserProjectMembership,
  UserRoleAssignment,
} from "./types";

type ProfileRow = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type PlatformAdminRow = {
  user_id: string;
  active: boolean;
};

type CompanyMembershipRow = {
  id: string;
  company_id: string;
  active: boolean;
  created_at: string;
  disabled_at: string | null;
};

type ProjectMembershipRow = {
  id: string;
  company_id: string;
  project_id: string;
  active: boolean;
  created_at: string;
  disabled_at: string | null;
};

type CompanyRoleRow = {
  id: string;
  company_member_id: string;
  role_id: string;
  assigned_at: string;
  revoked_at: string | null;
};

type ProjectRoleRow = {
  id: string;
  project_member_id: string;
  role_id: string;
  assigned_at: string;
  revoked_at: string | null;
};

type RoleRow = {
  id: string;
  code: string;
  name: string;
  scope: "COMPANY" | "PROJECT";
  active: boolean;
};

type CompanyRow = {
  id: string;
  name: string;
  code: string;
  status: string;
};

type ProjectRow = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  status: string;
};

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
};

async function requirePlatformQueryContext() {
  const supabase = await createServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId || !(await isPlatformAdmin(userId))) {
    throw new Error("No tienes autorización para consultar usuarios de plataforma.");
  }

  return { supabase, admin: createAdminClient(), userId };
}

function safeSearchTerm(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 100).toLocaleLowerCase();
}

function getAuthStatus(user: User): PlatformUserAuthStatus {
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) {
    return "BANNED";
  }

  if (user.email_confirmed_at) return "CONFIRMED";
  if (user.invited_at) return "INVITED";
  return "UNCONFIRMED";
}

function fallbackName(user: User) {
  return user.email?.split("@")[0] || `Usuario ${user.id.slice(0, 8)}`;
}

function safeAvatarUrl(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith("/")) return value;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchProfiles(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userIds: string[],
) {
  const profiles = new Map<string, ProfileRow>();

  for (let index = 0; index < userIds.length; index += 200) {
    const ids = userIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, active, created_at, updated_at")
      .in("id", ids);

    if (error) {
      throw new Error("No fue posible consultar los perfiles de usuario.");
    }

    for (const profile of (data ?? []) as ProfileRow[]) {
      profiles.set(profile.id, profile);
    }
  }

  return profiles;
}

async function fetchPlatformAdminIds(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userIds: string[],
) {
  const ids = new Set<string>();

  for (let index = 0; index < userIds.length; index += 200) {
    const chunk = userIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("platform_admins")
      .select("user_id, active")
      .in("user_id", chunk)
      .eq("active", true);

    if (error) {
      throw new Error("No fue posible consultar los accesos de plataforma.");
    }

    for (const row of (data ?? []) as PlatformAdminRow[]) {
      ids.add(row.user_id);
    }
  }

  return ids;
}

async function listAllAuthUsers(admin: ReturnType<typeof createAdminClient>) {
  const users: User[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });

    if (error) {
      throw new Error("No fue posible consultar los usuarios de autenticación.");
    }

    users.push(...data.users);
    if (!data.nextPage) break;
    page = data.nextPage;
  }

  return users;
}

function toListItems(
  users: User[],
  profiles: Map<string, ProfileRow>,
  platformAdminIds: Set<string>,
  currentUserId: string,
): PlatformUserListItem[] {
  return users.map((user) => {
    const profile = profiles.get(user.id);

    return {
      id: user.id,
      email: user.email ?? "Correo no disponible",
      fullName: profile?.full_name?.trim() || fallbackName(user),
      avatarUrl: safeAvatarUrl(profile?.avatar_url),
      profileActive: profile?.active ?? false,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      emailConfirmedAt: user.email_confirmed_at ?? null,
      authStatus: getAuthStatus(user),
      isPlatformAdmin: platformAdminIds.has(user.id),
      isCurrentUser: user.id === currentUserId,
    };
  });
}

export async function getPlatformUsers(
  filters: PlatformUserListFilters,
): Promise<PlatformUserListResult> {
  const { supabase, admin, userId: currentUserId } = await requirePlatformQueryContext();
  const search = safeSearchTerm(filters.query);
  const usesCrossSourceFilter = Boolean(search || filters.status !== "ALL");

  if (!usesCrossSourceFilter) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: filters.page,
      perPage: filters.pageSize,
    });

    if (error) {
      throw new Error("No fue posible consultar el listado de usuarios.");
    }

    const userIds = data.users.map((user) => user.id);
    const [profiles, platformAdminIds] = await Promise.all([
      fetchProfiles(supabase, userIds),
      fetchPlatformAdminIds(supabase, userIds),
    ]);
    const total = data.total;

    return {
      items: toListItems(data.users, profiles, platformAdminIds, currentUserId),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    };
  }

  const authUsers = await listAllAuthUsers(admin);
  const userIds = authUsers.map((user) => user.id);
  const [profiles, platformAdminIds] = await Promise.all([
    fetchProfiles(supabase, userIds),
    fetchPlatformAdminIds(supabase, userIds),
  ]);
  const filteredItems = toListItems(authUsers, profiles, platformAdminIds, currentUserId)
    .filter((user) => {
      const matchesSearch =
        !search ||
        user.email.toLocaleLowerCase().includes(search) ||
        user.fullName.toLocaleLowerCase().includes(search);
      const matchesStatus =
        filters.status === "ALL" ||
        (filters.status === "ACTIVE" && user.profileActive) ||
        (filters.status === "INACTIVE" && !user.profileActive);

      return matchesSearch && matchesStatus;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const from = (filters.page - 1) * filters.pageSize;
  const total = filteredItems.length;

  return {
    items: filteredItems.slice(from, from + filters.pageSize),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

function buildRoleAssignments(
  assignments: Array<CompanyRoleRow | ProjectRoleRow>,
  roles: Map<string, RoleRow>,
): UserRoleAssignment[] {
  return assignments.map((assignment) => {
    const role = roles.get(assignment.role_id);

    return {
      assignmentId: assignment.id,
      roleId: assignment.role_id,
      roleCode: role?.code ?? "ROLE_UNKNOWN",
      roleName: role?.name ?? "Rol no disponible",
      assignedAt: assignment.assigned_at,
      revokedAt: assignment.revoked_at,
      active: assignment.revoked_at === null,
    };
  });
}

export async function getPlatformUserDetail(
  userId: string,
): Promise<PlatformUserDetail | null> {
  const { supabase, admin, userId: currentUserId } = await requirePlatformQueryContext();
  const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);

  if (authError) {
    if (authError.status === 404) return null;
    throw new Error("No fue posible consultar el usuario de autenticación.");
  }

  if (!authData.user) return null;

  const [
    profileResult,
    platformResult,
    companiesResult,
    companyMembersResult,
    projectMembersResult,
    allProjectsResult,
    rolesResult,
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, avatar_url, active, created_at, updated_at")
        .eq("id", userId)
        .maybeSingle<ProfileRow>(),
      supabase
        .from("platform_admins")
        .select("user_id, active")
        .eq("user_id", userId)
        .maybeSingle<PlatformAdminRow>(),
      supabase
        .from("companies")
        .select("id, name, code, status")
        .order("name"),
      supabase
        .from("company_members")
        .select("id, company_id, active, created_at, disabled_at")
        .eq("user_id", userId)
        .order("created_at"),
      supabase
        .from("project_members")
        .select("id, company_id, project_id, active, created_at, disabled_at")
        .eq("user_id", userId)
        .order("created_at"),
      supabase
        .from("projects")
        .select("id, company_id, name, code, status")
        .order("name"),
      supabase
        .from("roles")
        .select("id, code, name, scope, active")
        .order("name"),
    ]);

  if (
    profileResult.error ||
    platformResult.error ||
    companiesResult.error ||
    companyMembersResult.error ||
    projectMembersResult.error ||
    allProjectsResult.error ||
    rolesResult.error
  ) {
    throw new Error("No fue posible cargar la información administrativa del usuario.");
  }

  const companyMembers = (companyMembersResult.data ?? []) as CompanyMembershipRow[];
  const projectMembers = (projectMembersResult.data ?? []) as ProjectMembershipRow[];
  const companyMemberIds = companyMembers.map((membership) => membership.id);
  const projectMemberIds = projectMembers.map((membership) => membership.id);

  const [companyRolesResult, projectRolesResult] = await Promise.all([
    companyMemberIds.length
      ? supabase
          .from("company_member_roles")
          .select("id, company_member_id, role_id, assigned_at, revoked_at")
          .in("company_member_id", companyMemberIds)
          .order("assigned_at")
      : Promise.resolve({ data: [], error: null }),
    projectMemberIds.length
      ? supabase
          .from("project_member_roles")
          .select("id, project_member_id, role_id, assigned_at, revoked_at")
          .in("project_member_id", projectMemberIds)
          .order("assigned_at")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyRolesResult.error || projectRolesResult.error) {
    throw new Error("No fue posible cargar los memberships y roles del usuario.");
  }

  const companyRoles = (companyRolesResult.data ?? []) as CompanyRoleRow[];
  const projectRoles = (projectRolesResult.data ?? []) as ProjectRoleRow[];
  const companies = (companiesResult.data ?? []) as CompanyRow[];
  const projects = (allProjectsResult.data ?? []) as ProjectRow[];
  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const roles = new Map(
    ((rolesResult.data ?? []) as RoleRow[]).map((role) => [role.id, role]),
  );
  const companyRolesByMembership = new Map<string, CompanyRoleRow[]>();
  const projectRolesByMembership = new Map<string, ProjectRoleRow[]>();

  for (const assignment of companyRoles) {
    const current = companyRolesByMembership.get(assignment.company_member_id) ?? [];
    current.push(assignment);
    companyRolesByMembership.set(assignment.company_member_id, current);
  }

  for (const assignment of projectRoles) {
    const current = projectRolesByMembership.get(assignment.project_member_id) ?? [];
    current.push(assignment);
    projectRolesByMembership.set(assignment.project_member_id, current);
  }

  const relatedEntityIds = [
    userId,
    ...companyMemberIds,
    ...projectMemberIds,
    ...companyRoles.map((assignment) => assignment.id),
    ...projectRoles.map((assignment) => assignment.id),
  ];
  const auditResult = await supabase
    .from("audit_events")
    .select("id, action, entity_type, created_at")
    .in("entity_id", relatedEntityIds)
    .order("created_at", { ascending: false })
    .limit(20);

  if (auditResult.error) {
    throw new Error("No fue posible cargar el historial administrativo del usuario.");
  }

  const companyMemberships: UserCompanyMembership[] = companyMembers.map((membership) => {
    const company = companyMap.get(membership.company_id);
    return {
      membershipId: membership.id,
      companyId: membership.company_id,
      companyName: company?.name ?? "Empresa no disponible",
      companyCode: company?.code ?? "—",
      active: membership.active,
      createdAt: membership.created_at,
      disabledAt: membership.disabled_at,
      roles: buildRoleAssignments(
        companyRolesByMembership.get(membership.id) ?? [],
        roles,
      ),
    };
  });
  const projectMemberships: UserProjectMembership[] = projectMembers.map((membership) => {
    const project = projectMap.get(membership.project_id);
    const company = companyMap.get(membership.company_id);
    return {
      membershipId: membership.id,
      companyId: membership.company_id,
      projectId: membership.project_id,
      projectName: project?.name ?? "Proyecto no disponible",
      projectCode: project?.code ?? "—",
      companyName: company?.name ?? "Empresa no disponible",
      active: membership.active,
      createdAt: membership.created_at,
      disabledAt: membership.disabled_at,
      roles: buildRoleAssignments(
        projectRolesByMembership.get(membership.id) ?? [],
        roles,
      ),
    };
  });
  const companyOptions: PlatformCompanyOption[] = companies
    .filter((company) => company.status === "ACTIVE")
    .map((company) => ({
      id: company.id,
      name: company.name,
      code: company.code,
    }));
  const activeCompanyIds = new Set(companyOptions.map((company) => company.id));
  const projectOptions: PlatformProjectOption[] = projects
    .filter(
      (project) => project.status === "ACTIVE" && activeCompanyIds.has(project.company_id),
    )
    .map((project) => ({
      id: project.id,
      companyId: project.company_id,
      name: project.name,
      code: project.code,
    }));
  const activeRoles = ((rolesResult.data ?? []) as RoleRow[]).filter(
    (role) => role.active,
  );
  const companyRoleOptions: PlatformRoleOption[] = activeRoles.filter(
    (role) => role.scope === "COMPANY",
  );
  const projectRoleOptions: PlatformRoleOption[] = activeRoles.filter(
    (role) => role.scope === "PROJECT",
  );
  const profile = profileResult.data;
  const listItem = toListItems(
    [authData.user],
    new Map(profile ? [[profile.id, profile]] : []),
    new Set(platformResult.data?.active ? [userId] : []),
    currentUserId,
  )[0];

  return {
    ...listItem,
    profileCreatedAt: profile?.created_at ?? null,
    profileUpdatedAt: profile?.updated_at ?? null,
    companyMemberships,
    projectMemberships,
    companyOptions,
    projectOptions,
    companyRoleOptions,
    projectRoleOptions,
    auditEvents: ((auditResult.data ?? []) as AuditRow[]).map((event) => ({
      id: event.id,
      action: event.action,
      entityType: event.entity_type,
      createdAt: event.created_at,
    })),
  };
}
