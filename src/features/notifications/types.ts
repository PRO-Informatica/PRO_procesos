export type OperationalNotification = {
  key: string; title: string; description: string; createdAt: string; projectId: string;
  projectName: string; type: "PROGRAMMING" | "INVOICE" | "RECONCILIATION" | "INCIDENT" | "DOCUMENT" | "BATCH";
  href: string; read: boolean;
};
