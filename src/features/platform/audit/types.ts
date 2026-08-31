export type AuditFilters = {
  page: number;
  pageSize: number;
  actorId: string;
  action: string;
  companyId: string;
  entityType: string;
  fromDate: string;
  toDate: string;
};

export type AuditEventItem = {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectName: string | null;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

export type AuditFilterOption = {
  value: string;
  label: string;
};

export type AuditFilterOptions = {
  actors: AuditFilterOption[];
  actions: string[];
  companies: AuditFilterOption[];
  entityTypes: string[];
};

export type AuditListResult = {
  items: AuditEventItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  options: AuditFilterOptions;
};
