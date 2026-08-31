import { MotionPage } from "@/components/motion/motion-page";
import { AuditList } from "@/features/platform/audit/components/audit-list";
import { getGlobalAudit } from "@/features/platform/audit/queries";
import type { AuditFilters } from "@/features/platform/audit/types";

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function safeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : "";
}

function safeCode(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9_]{1,80}$/.test(normalized) ? normalized : "";
}

function safeEntityType(value: string) {
  const normalized = value.trim();
  return /^[A-Za-z0-9_]{1,80}$/.test(normalized) ? normalized : "";
}

function safeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

function parseFilters(
  params: Record<string, string | string[] | undefined>,
): AuditFilters {
  const rawPage = Number.parseInt(readParam(params.page), 10);

  return {
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: 25,
    actorId: safeUuid(readParam(params.actor)),
    action: safeCode(readParam(params.action)),
    companyId: safeUuid(readParam(params.company)),
    entityType: safeEntityType(readParam(params.entity)),
    fromDate: safeDate(readParam(params.from)),
    toDate: safeDate(readParam(params.to)),
  };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const result = await getGlobalAudit(filters);

  return (
    <MotionPage>
      <AuditList result={result} filters={filters} />
    </MotionPage>
  );
}
