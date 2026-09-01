export type DocumentFilters = {
  projectId?: string; type?: string; order?: string; guide?: string; invoice?: string;
  userId?: string; dateFrom?: string; dateTo?: string;
};
export type DocumentOption = { value: string; label: string };
export type GlobalDocument = {
  id: string; projectId: string; projectName: string; name: string; mimeType: string;
  type: string; context: string; orderNumber: string | null; guideNumber: string | null;
  invoiceNumber: string | null; date: string; uploadedById: string; uploadedBy: string;
  status: string;
};
export type GlobalDocumentsData = { documents: GlobalDocument[]; projects: DocumentOption[]; users: DocumentOption[] };
