export type ProjectStatus = "ACTIVE" | "INACTIVE" | "CLOSED";

export type ProjectSummary = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  code: string;
  status: ProjectStatus;
  timezone: string;
};

export type ProjectContextData = {
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
  roleCodes: string[];
  permissions: string[];
  isCompanyAdmin: boolean;
};

export type ProjectContextState =
  | ({ status: "ready" } & ProjectContextData)
  | ({ status: "empty" } & ProjectContextData)
  | ({ status: "error"; message: string } & ProjectContextData);

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
};
