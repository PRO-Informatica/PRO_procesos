import type { CompanyStatus } from "../types";

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const active = status === "ACTIVE";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-success-soft text-success"
          : "bg-muted text-foreground-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${active ? "bg-success" : "bg-foreground-muted"}`}
      />
      {active ? "Activa" : "Inactiva"}
    </span>
  );
}
