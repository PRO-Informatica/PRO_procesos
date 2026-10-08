import { notFound } from "next/navigation";

import { MotionPage } from "@/components/motion/motion-page";
import { ProjectPriceCatalogsView } from "@/features/platform/project-price-catalogs/components/project-price-catalogs-view";
import { getProjectPriceCatalogs } from "@/features/platform/project-price-catalogs/queries";

function pageNumber(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function queryValue(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ProjectPriceCatalogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id: companyId, projectId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/iu.test(companyId) || !/^[0-9a-f-]{36}$/iu.test(projectId)) notFound();

  const data = await getProjectPriceCatalogs(companyId, projectId, {
    productQuery: queryValue(query.productQuery),
    productPage: pageNumber(query.productPage),
    serviceQuery: queryValue(query.serviceQuery),
    servicePage: pageNumber(query.servicePage),
  });
  if (!data) notFound();
  return <MotionPage><ProjectPriceCatalogsView data={data} /></MotionPage>;
}
