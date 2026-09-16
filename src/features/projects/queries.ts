import "server-only";

import { cookies } from "next/headers";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createClient } from "@/lib/supabase/server";

import {
  hasUniversalOperationalViewRole,
  PLATFORM_ADMIN_VIEW_SOURCE_ROLES,
  selectOperationalViewPermissions,
} from "./access-policy";
import type {
  ProjectContextState,
  ProjectAccessScope,
  ProjectStatus,
  ProjectSummary,
} from "./types";
import { emptyProjectContext } from "./types";

export const ACTIVE_PROJECT_COOKIE = "pro_active_project";

type ProjectRow = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  billing_legal_name: string | null;
  billing_tax_id: string | null;
  address: string;
  status: ProjectStatus;
  timezone: string | null;
};

type CompanyRow = {
  id: string;
  code: string;
  name: string;
};

type ProjectMembershipRow = {
  project_id: string;
};

type CompanyMembershipRow = {
  id: string;
  company_id: string;
};

type CompanyRoleAssignmentRow = {
  company_member_id: string;
  role_id: string;
};

type PlatformAdminOperationalViewAccess = {
  roleCodes: ["PLATFORM_ADMIN"];
  permissions: string[];
  isCompanyAdmin: false;
};

const PROJECT_COLUMNS =
  "id, company_id, name, code, address, billing_legal_name, billing_tax_id, status, timezone";

async function getPlatformAdminOperationalViewAccess(
  userId: string,
): Promise<PlatformAdminOperationalViewAccess | null> {
  if (!(await isPlatformAdmin(userId))) return null;

  const supabase = await createClient();
  const { data: roles, error: rolesError } = await supabase
    .from("roles")
    .select("id, code")
    .in("code", [...PLATFORM_ADMIN_VIEW_SOURCE_ROLES])
    .eq("active", true);
  if (rolesError || roles.length !== PLATFORM_ADMIN_VIEW_SOURCE_ROLES.length) {
    throw new Error("No fue posible resolver las vistas operativas de plataforma.");
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("role_permissions")
    .select("permission_id")
    .in("role_id", roles.map((role) => role.id as string));
  if (assignmentsError) {
    throw new Error("No fue posible resolver los permisos operativos de plataforma.");
  }

  const permissionIds = [
    ...new Set(assignments.map((assignment) => assignment.permission_id as string)),
  ];
  const { data: permissions, error: permissionsError } = permissionIds.length
    ? await supabase
        .from("permissions")
        .select("code")
        .in("id", permissionIds)
        .eq("active", true)
    : { data: [], error: null };
  if (permissionsError) {
    throw new Error("No fue posible cargar las vistas operativas de plataforma.");
  }

  return {
    roleCodes: ["PLATFORM_ADMIN"],
    permissions: selectOperationalViewPermissions(
      permissions.map((permission) => permission.code as string),
    ),
    isCompanyAdmin: false,
  };
}

async function getOperationalProjectRowsForAccess(
  userId: string,
  platformAdminAccess: PlatformAdminOperationalViewAccess | null,
): Promise<ProjectRow[]> {
  const supabase = await createClient();
  if (platformAdminAccess) {
    const { data, error } = await supabase.from("projects").select(PROJECT_COLUMNS);
    if (error) throw new Error("No fue posible consultar los proyectos de plataforma.");
    return (data ?? []) as ProjectRow[];
  }
  return getMemberOperationalProjectRows(userId);
}

export async function getOperationalProjectRows(userId: string): Promise<ProjectRow[]> {
  return getOperationalProjectRowsForAccess(
    userId,
    await getPlatformAdminOperationalViewAccess(userId),
  );
}

async function getMemberOperationalProjectRows(userId: string): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const [projectMembershipsResult, companyMembershipsResult] = await Promise.all([
    supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId)
      .eq("active", true),
    supabase
      .from("company_members")
      .select("id, company_id")
      .eq("user_id", userId)
      .eq("active", true),
  ]);

  if (projectMembershipsResult.error || companyMembershipsResult.error) {
    throw new Error("No fue posible consultar las membresías operacionales.");
  }

  const directProjectIds = [
    ...new Set(
      ((projectMembershipsResult.data ?? []) as ProjectMembershipRow[]).map(
        (membership) => membership.project_id,
      ),
    ),
  ];
  const companyMemberships = (companyMembershipsResult.data ?? []) as CompanyMembershipRow[];
  const companyMembershipIds = companyMemberships.map((membership) => membership.id);
  let administeredCompanyIds: string[] = [];

  if (companyMembershipIds.length > 0) {
    const { data: assignmentsData, error: assignmentsError } = await supabase
      .from("company_member_roles")
      .select("company_member_id, role_id")
      .in("company_member_id", companyMembershipIds)
      .is("revoked_at", null);

    if (assignmentsError) {
      throw new Error("No fue posible consultar los roles de empresa.");
    }

    const assignments = (assignmentsData ?? []) as CompanyRoleAssignmentRow[];
    const assignedRoleIds = [
      ...new Set(assignments.map((assignment) => assignment.role_id)),
    ];

    if (assignedRoleIds.length > 0) {
      const { data: companyAdminRoles, error: rolesError } = await supabase
        .from("roles")
        .select("id")
        .in("id", assignedRoleIds)
        .eq("code", "COMPANY_ADMIN")
        .eq("active", true);

      if (rolesError) {
        throw new Error("No fue posible verificar el rol de administrador de empresa.");
      }

      const companyAdminRoleIds = new Set(
        (companyAdminRoles ?? []).map((role) => role.id as string),
      );
      const adminMembershipIds = new Set(
        assignments
          .filter((assignment) => companyAdminRoleIds.has(assignment.role_id))
          .map((assignment) => assignment.company_member_id),
      );

      administeredCompanyIds = [
        ...new Set(
          companyMemberships
            .filter((membership) => adminMembershipIds.has(membership.id))
            .map((membership) => membership.company_id),
        ),
      ];
    }
  }

  if (directProjectIds.length === 0 && administeredCompanyIds.length === 0) {
    return [];
  }

  const [memberProjectsResult, companyProjectsResult] = await Promise.all([
    directProjectIds.length > 0
      ? supabase.from("projects").select(PROJECT_COLUMNS).in("id", directProjectIds)
      : Promise.resolve({ data: [], error: null }),
    administeredCompanyIds.length > 0
      ? supabase
          .from("projects")
          .select(PROJECT_COLUMNS)
          .in("company_id", administeredCompanyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (memberProjectsResult.error || companyProjectsResult.error) {
    throw new Error("No fue posible consultar los proyectos operacionales.");
  }

  const projectsById = new Map<string, ProjectRow>();
  for (const project of [
    ...(memberProjectsResult.data ?? []),
    ...(companyProjectsResult.data ?? []),
  ] as ProjectRow[]) {
    projectsById.set(project.id, project);
  }

  return [...projectsById.values()];
}

export async function canAccessOperationalProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const projects = await getOperationalProjectRows(userId);
  return projects.some((project) => project.id === projectId);
}

async function resolveRolesAndPermissionsForAccess(
  userId: string,
  project: ProjectSummary,
  platformAdminAccess: PlatformAdminOperationalViewAccess | null,
) {
  if (platformAdminAccess) return platformAdminAccess;
  const supabase = await createClient();

  const [projectMembershipResult, companyMembershipResult] = await Promise.all([
    supabase
      .from("project_members")
      .select("id")
      .eq("project_id", project.id)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle(),
    supabase
      .from("company_members")
      .select("id")
      .eq("company_id", project.companyId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (projectMembershipResult.error || companyMembershipResult.error) {
    throw new Error("No fue posible resolver las membresías del proyecto.");
  }

  const [projectAssignmentsResult, companyAssignmentsResult] = await Promise.all([
    projectMembershipResult.data
      ? supabase
          .from("project_member_roles")
          .select("role_id")
          .eq("project_member_id", projectMembershipResult.data.id)
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null }),
    companyMembershipResult.data
      ? supabase
          .from("company_member_roles")
          .select("role_id")
          .eq("company_member_id", companyMembershipResult.data.id)
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (projectAssignmentsResult.error || companyAssignmentsResult.error) {
    throw new Error("No fue posible resolver los roles activos.");
  }

  const roleIds = [
    ...new Set(
      [...projectAssignmentsResult.data, ...companyAssignmentsResult.data].map(
        (assignment) => assignment.role_id as string,
      ),
    ),
  ];

  if (roleIds.length === 0) {
    return { roleCodes: [], permissions: [], isCompanyAdmin: false };
  }

  const [rolesResult, rolePermissionsResult] = await Promise.all([
    supabase.from("roles").select("id, code").in("id", roleIds).eq("active", true),
    supabase.from("role_permissions").select("permission_id").in("role_id", roleIds),
  ]);

  if (rolesResult.error || rolePermissionsResult.error) {
    throw new Error("No fue posible cargar la configuración de acceso.");
  }

  const permissionIds = [
    ...new Set(
      rolePermissionsResult.data.map(
        (assignment) => assignment.permission_id as string,
      ),
    ),
  ];

  const permissionsResult = permissionIds.length
    ? await supabase
        .from("permissions")
        .select("code")
        .in("id", permissionIds)
        .eq("active", true)
    : { data: [], error: null };

  if (permissionsResult.error) {
    throw new Error("No fue posible cargar los permisos del proyecto.");
  }

  const roleCodes = [...new Set(rolesResult.data.map((role) => role.code as string))];
  const permissions = [
    ...new Set(permissionsResult.data.map((permission) => permission.code as string)),
  ];

  return {
    roleCodes,
    permissions,
    isCompanyAdmin: roleCodes.includes("COMPANY_ADMIN"),
  };
}

export async function resolveRolesAndPermissions(
  userId: string,
  project: ProjectSummary,
) {
  return resolveRolesAndPermissionsForAccess(
    userId,
    project,
    await getPlatformAdminOperationalViewAccess(userId),
  );
}

export async function getOperationalProjectAccess(
  userId: string,
): Promise<ProjectAccessScope[]> {
  const platformAdminAccess = await getPlatformAdminOperationalViewAccess(userId);
  const rows = await getOperationalProjectRowsForAccess(userId, platformAdminAccess);
  if (!rows.length) return [];
  const supabase = await createClient();
  const companyIds = [...new Set(rows.map((project) => project.company_id))];
  const { data: companyRows, error } = await supabase
    .from("companies")
    .select("id, code, name")
    .in("id", companyIds);
  if (error) throw new Error("No fue posible consultar las empresas de los proyectos.");
  const companies = new Map(
    ((companyRows ?? []) as CompanyRow[]).map((company) => [company.id, company]),
  );
  const projects = rows.map((project): ProjectSummary => ({
    id: project.id,
    companyId: project.company_id,
    companyCode: companies.get(project.company_id)?.code ?? "",
    companyName: companies.get(project.company_id)?.name ?? "Empresa",
    name: project.name,
    code: project.code,
    address: project.address,
    billingLegalName: project.billing_legal_name,
    billingTaxId: project.billing_tax_id,
    status: project.status,
    timezone: project.timezone ?? "America/Guatemala",
  }));
  return Promise.all(
    projects.map(async (project) => {
      const access = await resolveRolesAndPermissionsForAccess(
        userId,
        project,
        platformAdminAccess,
      );
      return { project, roleCodes: access.roleCodes, permissions: access.permissions };
    }),
  );
}

export async function getOperationalProjectAccessForProject(
  userId: string,
  projectId: string,
): Promise<ProjectAccessScope | null> {
  const platformAdminAccess = await getPlatformAdminOperationalViewAccess(userId);
  const row = (
    await getOperationalProjectRowsForAccess(userId, platformAdminAccess)
  ).find((project) => project.id === projectId);
  if (!row) return null;
  const supabase = await createClient();
  const { data: company, error } = await supabase
    .from("companies")
    .select("code, name")
    .eq("id", row.company_id)
    .maybeSingle();
  if (error) throw new Error("No fue posible consultar la empresa del proyecto.");
  const project: ProjectSummary = {
    id: row.id,
    companyId: row.company_id,
    companyCode: company?.code ?? "",
    companyName: company?.name ?? "Empresa",
    name: row.name,
    code: row.code,
    address: row.address,
    billingLegalName: row.billing_legal_name,
    billingTaxId: row.billing_tax_id,
    status: row.status,
    timezone: row.timezone ?? "America/Guatemala",
  };
  const access = await resolveRolesAndPermissionsForAccess(
    userId,
    project,
    platformAdminAccess,
  );
  return { project, roleCodes: access.roleCodes, permissions: access.permissions };
}

export async function getProjectContext(userId: string): Promise<ProjectContextState> {
  try {
    const supabase = await createClient();
    const platformAdminAccess = await getPlatformAdminOperationalViewAccess(userId);
    const rows = await getOperationalProjectRowsForAccess(userId, platformAdminAccess);

    if (rows.length === 0) {
      return { status: "empty", ...emptyProjectContext };
    }

    const companyIds = [...new Set(rows.map((project) => project.company_id))];
    const { data: companyRows, error: companiesError } = await supabase
      .from("companies")
      .select("id, code, name")
      .in("id", companyIds);

    if (companiesError) {
      throw new Error("No fue posible consultar las empresas de los proyectos.");
    }

    const companies = new Map(
      ((companyRows ?? []) as CompanyRow[]).map((company) => [company.id, company]),
    );

    const projects: ProjectSummary[] = rows
      .map((project) => ({
        id: project.id,
        companyId: project.company_id,
        companyCode: companies.get(project.company_id)?.code ?? "",
        companyName: companies.get(project.company_id)?.name ?? "Empresa",
        name: project.name,
        code: project.code,
        billingLegalName: project.billing_legal_name,
        billingTaxId: project.billing_tax_id,
        address: project.address,
        status: project.status,
        timezone: project.timezone ?? "America/Guatemala",
      }))
      .sort((left, right) => {
        const statusOrder: Record<ProjectStatus, number> = {
          ACTIVE: 0,
          INACTIVE: 1,
          CLOSED: 2,
        };
        return statusOrder[left.status] - statusOrder[right.status] ||
          left.name.localeCompare(right.name);
      });

    const cookieStore = await cookies();
    const storedProjectId = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;
    const activeProject =
      projects.find((project) => project.id === storedProjectId) ?? projects[0];
    const accessByProject = await Promise.all(
      projects.map(async (project) => ({
        project,
        access: await resolveRolesAndPermissionsForAccess(
          userId,
          project,
          platformAdminAccess,
        ),
      })),
    );
    const access = accessByProject.find(({ project }) => project.id === activeProject.id)!.access;

    return {
      status: "ready",
      projects,
      activeProject,
      ...access,
      hasUniversalInvoiceAccess: accessByProject.some(({ access: item }) =>
        item.permissions.includes("invoice.universal"),
      ),
      hasUniversalBatchAccess: accessByProject.some(({ project, access: item }) =>
        project.status === "ACTIVE" &&
        item.permissions.includes("batch.view") &&
        hasUniversalOperationalViewRole(item.roleCodes),
      ),
      hasUniversalReportAccess: accessByProject.some(({ project, access: item }) =>
        project.status === "ACTIVE" &&
        item.permissions.includes("dispatch.view") &&
        hasUniversalOperationalViewRole(item.roleCodes),
      ),
    };
  } catch (error) {
    return {
      status: "error",
      ...emptyProjectContext,
      message:
        error instanceof Error
          ? error.message
          : "No fue posible cargar el contexto del proyecto.",
    };
  }
}
