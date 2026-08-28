export type PlatformUserProfileStatus = "ACTIVE" | "INACTIVE";

export type PlatformUserAuthStatus =
  | "BANNED"
  | "CONFIRMED"
  | "INVITED"
  | "UNCONFIRMED";

export type PlatformUserListFilters = {
  page: number;
  pageSize: number;
  query: string;
  status: PlatformUserProfileStatus | "ALL";
};

export type PlatformUserListItem = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  profileActive: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  authStatus: PlatformUserAuthStatus;
  isPlatformAdmin: boolean;
  isCurrentUser: boolean;
};

export type PlatformUserListResult = {
  items: PlatformUserListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type UserRoleAssignment = {
  assignmentId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  assignedAt: string;
  revokedAt: string | null;
  active: boolean;
};

export type UserCompanyMembership = {
  membershipId: string;
  companyId: string;
  companyName: string;
  companyCode: string;
  active: boolean;
  createdAt: string;
  disabledAt: string | null;
  roles: UserRoleAssignment[];
};

export type UserProjectMembership = {
  membershipId: string;
  companyId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  companyName: string;
  active: boolean;
  createdAt: string;
  disabledAt: string | null;
  roles: UserRoleAssignment[];
};

export type PlatformCompanyOption = {
  id: string;
  name: string;
  code: string;
};

export type CompanyAdminOption = PlatformCompanyOption & {
  alreadyAdmin: boolean;
};

export type PlatformProjectOption = {
  id: string;
  companyId: string;
  name: string;
  code: string;
};

export type PlatformRoleOption = {
  id: string;
  code: string;
  name: string;
  scope: "COMPANY" | "PROJECT";
};

export type UserAuditEvent = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
};

export type PlatformUserDetail = PlatformUserListItem & {
  profileCreatedAt: string | null;
  profileUpdatedAt: string | null;
  companyMemberships: UserCompanyMembership[];
  projectMemberships: UserProjectMembership[];
  companyOptions: PlatformCompanyOption[];
  projectOptions: PlatformProjectOption[];
  companyRoleOptions: PlatformRoleOption[];
  projectRoleOptions: PlatformRoleOption[];
  auditEvents: UserAuditEvent[];
};

export type PlatformUserActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fields?: {
    email?: string;
    fullName?: string;
    companyId?: string;
    projectId?: string;
    membershipId?: string;
    roleId?: string;
  };
};

export const initialPlatformUserActionState: PlatformUserActionState = {
  status: "idle",
};
