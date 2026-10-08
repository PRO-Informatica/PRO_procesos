import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  PriceCatalogPage,
  ProjectPriceCatalogsData,
  ProjectProductPrice,
  ProjectServicePrice,
} from "./types";

const PAGE_SIZE = 25;

type CatalogFilters = {
  productQuery: string;
  productPage: number;
  serviceQuery: string;
  servicePage: number;
};

type ProductRow = {
  id: string;
  code: string;
  reference: string;
  price: string | number;
  updated_at: string;
};

type ServiceRow = {
  id: string;
  code: string;
  price: string | number;
  updated_at: string;
};

function safeSearchTerm(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
}

function validPage(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

async function getProductCatalog(
  projectId: string,
  rawQuery: string,
  rawPage: number,
): Promise<PriceCatalogPage<ProjectProductPrice>> {
  const supabase = await createClient();
  const query = safeSearchTerm(rawQuery);
  const requestedPage = validPage(rawPage);
  const from = (requestedPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let rowsQuery = supabase
    .from("project_product_prices")
    .select("id, code, reference, price, updated_at", { count: "exact" })
    .eq("project_id", projectId)
    .order("code")
    .order("reference")
    .range(from, to);
  if (query) rowsQuery = rowsQuery.or(`code.ilike.%${query}%,reference.ilike.%${query}%`);

  const [rowsResult, latestResult] = await Promise.all([
    rowsQuery,
    supabase
      .from("project_product_prices")
      .select("updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ updated_at: string }>(),
  ]);
  if (rowsResult.error || latestResult.error) {
    throw new Error("No fue posible cargar el catálogo de productos.");
  }

  const total = rowsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (requestedPage > totalPages) {
    return getProductCatalog(projectId, query, totalPages);
  }
  const page = Math.min(requestedPage, totalPages);
  return {
    items: ((rowsResult.data ?? []) as ProductRow[]).map((row) => ({
      id: row.id,
      code: row.code,
      reference: row.reference,
      price: String(row.price),
      updatedAt: row.updated_at,
    })),
    total,
    page,
    totalPages,
    query,
    lastUpdatedAt: latestResult.data?.updated_at ?? null,
  };
}

async function getServiceCatalog(
  projectId: string,
  rawQuery: string,
  rawPage: number,
): Promise<PriceCatalogPage<ProjectServicePrice>> {
  const supabase = await createClient();
  const query = safeSearchTerm(rawQuery);
  const requestedPage = validPage(rawPage);
  const from = (requestedPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let rowsQuery = supabase
    .from("project_service_prices")
    .select("id, code, price, updated_at", { count: "exact" })
    .eq("project_id", projectId)
    .order("code")
    .range(from, to);
  if (query) rowsQuery = rowsQuery.ilike("code", `%${query}%`);

  const [rowsResult, latestResult] = await Promise.all([
    rowsQuery,
    supabase
      .from("project_service_prices")
      .select("updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ updated_at: string }>(),
  ]);
  if (rowsResult.error || latestResult.error) {
    throw new Error("No fue posible cargar el catálogo de servicios.");
  }

  const total = rowsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (requestedPage > totalPages) {
    return getServiceCatalog(projectId, query, totalPages);
  }
  const page = Math.min(requestedPage, totalPages);
  return {
    items: ((rowsResult.data ?? []) as ServiceRow[]).map((row) => ({
      id: row.id,
      code: row.code,
      price: String(row.price),
      updatedAt: row.updated_at,
    })),
    total,
    page,
    totalPages,
    query,
    lastUpdatedAt: latestResult.data?.updated_at ?? null,
  };
}

export async function getProjectPriceCatalogs(
  companyId: string,
  projectId: string,
  filters: CatalogFilters,
): Promise<ProjectPriceCatalogsData | null> {
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, company_id, name, code")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string; company_id: string; name: string; code: string }>();
  if (projectError) throw new Error("No fue posible consultar el proyecto.");
  if (!project) return null;

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle<{ id: string; name: string }>();
  if (companyError) throw new Error("No fue posible consultar la empresa.");
  if (!company) return null;

  const [products, services] = await Promise.all([
    getProductCatalog(projectId, filters.productQuery, filters.productPage),
    getServiceCatalog(projectId, filters.serviceQuery, filters.servicePage),
  ]);
  return { company, project, products, services };
}
