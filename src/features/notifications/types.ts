export type OperationalNotification = {
  key: string; title: string; description: string; createdAt: string; projectId: string;
  projectName: string; type: "PROGRAMMING" | "INVOICE" | "RECONCILIATION" | "INCIDENT" | "DOCUMENT";
  href: string; read: boolean;
};
