import { notFound } from "next/navigation";

import { MotionPage } from "@/components/motion/motion-page";
import { CompanyDetailView } from "@/features/platform/companies/components/company-detail-view";
import { getCompanyDetail } from "@/features/platform/companies/queries";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }

  const company = await getCompanyDetail(id);
  if (!company) notFound();

  return (
    <MotionPage>
      <CompanyDetailView company={company} />
    </MotionPage>
  );
}
