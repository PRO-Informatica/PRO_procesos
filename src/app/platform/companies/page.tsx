import { MotionPage } from "@/components/motion/motion-page";
import { CompaniesList } from "@/features/platform/companies/components/companies-list";
import { getCompanies } from "@/features/platform/companies/queries";
import type {
  CompanyListFilters,
  CompanyStatus,
} from "@/features/platform/companies/types";

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function parseFilters(params: Record<string, string | string[] | undefined>): CompanyListFilters {
  const rawPage = Number.parseInt(readParam(params.page), 10);
  const rawStatus = readParam(params.status);
  const status: CompanyStatus | "ALL" =
    rawStatus === "ACTIVE" || rawStatus === "INACTIVE" ? rawStatus : "ALL";

  return {
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: 10,
    query: readParam(params.q).trim().slice(0, 80),
    status,
  };
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const result = await getCompanies(filters);

  return (
    <MotionPage>
      <CompaniesList result={result} filters={filters} />
    </MotionPage>
  );
}
