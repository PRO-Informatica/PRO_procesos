export type CompanyStatus = "ACTIVE" | "INACTIVE";

export type CompanyListFilters = {
  page: number;
  pageSize: number;
  query: string;
  status: CompanyStatus | "ALL";
};

export type CompanyListItem = {
  id: string;
  name: string;
  code: string;
  status: CompanyStatus;
  createdAt: string;
  projectCount: number;
  activeUserCount: number;
  companyAdmins: string[];
};

export type CompanyListResult = {
  items: CompanyListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CompanyProject = {
  id: string;
  name: string;
  code: string;
  status: string;
  timezone: string;
  startDate: string | null;
  estimatedEndDate: string | null;
};

export type CompanyUser = {
  membershipId: string;
  userId: string;
  name: string;
  active: boolean;
  roles: string[];
  createdAt: string;
};

export type CompanyDetail = {
  id: string;
  name: string;
  code: string;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
  projects: CompanyProject[];
  users: CompanyUser[];
  companyAdmins: string[];
};

export type CompanyActionState = {
  status: "idle" | "error";
  message?: string;
  fields?: {
    name?: string;
    code?: string;
  };
};

export const initialCompanyActionState: CompanyActionState = { status: "idle" };
