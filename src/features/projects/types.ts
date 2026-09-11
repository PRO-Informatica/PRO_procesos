export type ProjectStatus = "ACTIVE" | "INACTIVE" | "CLOSED";

export type ProjectSummary = {
  id: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  name: string;
  code: string;
  billingLegalName: string | null;
  billingTaxId: string | null;
  address: string;
  status: ProjectStatus;
  timezone: string;
};

export type ProjectContextData = {
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
  roleCodes: string[];
  permissions: string[];
  isCompanyAdmin: boolean;
  hasUniversalInvoiceAccess: boolean;
  hasUniversalBatchAccess: boolean;
  hasUniversalReportAccess: boolean;
};

export type ProjectContextState =
  | ({ status: "ready" } & ProjectContextData)
  | ({ status: "empty" } & ProjectContextData)
  | ({ status: "error"; message: string } & ProjectContextData);

export type ProjectAccessScope = {
  project: ProjectSummary;
  roleCodes: string[];
  permissions: string[];
};

export type SwitchProjectState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export const emptyProjectContext: ProjectContextData = {
  projects: [],
  activeProject: null,
  roleCodes: [],
  permissions: [],
  isCompanyAdmin: false,
  hasUniversalInvoiceAccess: false,
  hasUniversalBatchAccess: false,
  hasUniversalReportAccess: false,
};
