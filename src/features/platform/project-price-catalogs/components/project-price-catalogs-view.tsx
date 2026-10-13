import { ArrowLeft, Boxes, Search, Wrench } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionSection } from "@/components/motion/motion-section";

import type {
  PriceCatalogPage,
  ProjectPriceCatalogsData,
  ProjectProductPrice,
  ProjectServicePrice,
} from "../types";
import { ImportPriceCatalogDialog } from "./import-price-catalog-dialog";

function money(value: string) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value));
}

function dateTime(value: string | null) {
  if (!value) return "Sin cargas todavía";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Guatemala",
  }).format(new Date(value));
}

function pageHref(
  data: ProjectPriceCatalogsData,
  kind: "product" | "service",
  page: number,
) {
  const params = new URLSearchParams();
  if (data.products.query) params.set("productQuery", data.products.query);
  if (data.services.query) params.set("serviceQuery", data.services.query);
  if (kind === "product") {
    params.set("productPage", String(page));
    if (data.services.page > 1) params.set("servicePage", String(data.services.page));
  } else {
    params.set("servicePage", String(page));
    if (data.products.page > 1) params.set("productPage", String(data.products.page));
  }
  return `?${params.toString()}`;
}

function clearHref(data: ProjectPriceCatalogsData, kind: "product" | "service") {
  const params = new URLSearchParams();
  if (kind === "product") {
    if (data.services.query) params.set("serviceQuery", data.services.query);
    if (data.services.page > 1) params.set("servicePage", String(data.services.page));
  } else {
    if (data.products.query) params.set("productQuery", data.products.query);
    if (data.products.page > 1) params.set("productPage", String(data.products.page));
  }
  const query = params.toString();
  return query ? `?${query}` : "?";
}

export function ProjectPriceCatalogsView({ data }: { data: ProjectPriceCatalogsData }) {
  return (
    <div className="mx-auto max-w-[1320px]">
      <Link
        href={`/platform/companies/${data.company.id}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {data.company.name}
      </Link>
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Parámetros del proyecto</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Catálogos de precios</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          {data.project.name} · {data.project.code}. Los precios son independientes para este proyecto.
        </p>
      </div>

      <CatalogSection
        title="Catálogo de productos"
        description="Productos identificados por la combinación de código y referencia."
        icon={Boxes}
        companyId={data.company.id}
        projectId={data.project.id}
        kind="PRODUCT"
        catalog={data.products}
        otherQuery={data.services.query}
        otherPage={data.services.page}
        data={data}
      />
      <CatalogSection
        title="Catálogo de servicios"
        description="Servicios identificados por código."
        icon={Wrench}
        companyId={data.company.id}
        projectId={data.project.id}
        kind="SERVICE"
        catalog={data.services}
        otherQuery={data.products.query}
        otherPage={data.products.page}
        data={data}
      />
    </div>
  );
}

function CatalogSection({
  title,
  description,
  icon: Icon,
  companyId,
  projectId,
  kind,
  catalog,
  otherQuery,
  otherPage,
  data,
}: {
  title: string;
  description: string;
  icon: typeof Boxes;
  companyId: string;
  projectId: string;
  kind: "PRODUCT" | "SERVICE";
  catalog: PriceCatalogPage<ProjectProductPrice> | PriceCatalogPage<ProjectServicePrice>;
  otherQuery: string;
  otherPage: number;
  data: ProjectPriceCatalogsData;
}) {
  const queryName = kind === "PRODUCT" ? "productQuery" : "serviceQuery";
  const otherQueryName = kind === "PRODUCT" ? "serviceQuery" : "productQuery";
  const otherPageName = kind === "PRODUCT" ? "servicePage" : "productPage";
  return (
    <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-col gap-4 border-b border-border p-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Icon className="size-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-foreground-muted">{description}</p>
            <p className="mt-2 text-xs text-foreground-muted">
              {catalog.total} registro(s) · Última actualización: {dateTime(catalog.lastUpdatedAt)}
            </p>
          </div>
        </div>
        <ImportPriceCatalogDialog companyId={companyId} projectId={projectId} catalogKind={kind} />
      </div>

      <form className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:px-8" method="get">
        {otherQuery && <input type="hidden" name={otherQueryName} value={otherQuery} />}
        {otherPage > 1 && <input type="hidden" name={otherPageName} value={otherPage} />}
        <label className="relative flex-1">
          <span className="sr-only">Buscar en {title.toLowerCase()}</span>
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
          <input
            name={queryName}
            defaultValue={catalog.query}
            className="form-input pl-10"
            placeholder={kind === "PRODUCT" ? "Buscar por código o referencia" : "Buscar por código"}
          />
        </label>
        <button className="secondary-button" type="submit">Buscar</button>
        {catalog.query && (
          <Link
            className="ghost-button"
            href={clearHref(data, kind === "PRODUCT" ? "product" : "service")}
          >
            Limpiar
          </Link>
        )}
      </form>

      {catalog.items.length === 0 ? (
        <div className="p-6 sm:p-8">
          <EmptyState
            title={catalog.query ? "Sin coincidencias" : "Catálogo vacío"}
            description={catalog.query ? "Prueba con otro término de búsqueda." : "Importa un archivo Excel para registrar los precios de este proyecto."}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/80 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
              <tr>
                <th className="px-6 py-3.5 sm:px-8">Código</th>
                {kind === "PRODUCT" && <th className="px-4 py-3.5">Referencia</th>}
                <th className="px-6 py-3.5 text-right sm:px-8">Precio unitario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {catalog.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 font-mono font-semibold sm:px-8">{item.code}</td>
                  {kind === "PRODUCT" && <td className="px-4 py-4 font-mono">{(item as ProjectProductPrice).reference}</td>}
                  <td className="px-6 py-4 text-right font-semibold sm:px-8">{money(item.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {catalog.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-6 py-4 text-sm sm:px-8">
          <span className="text-foreground-muted">Página {catalog.page} de {catalog.totalPages}</span>
          <div className="flex gap-2">
            {catalog.page > 1 && <Link className="secondary-button" href={pageHref(data, kind === "PRODUCT" ? "product" : "service", catalog.page - 1)}>Anterior</Link>}
            {catalog.page < catalog.totalPages && <Link className="secondary-button" href={pageHref(data, kind === "PRODUCT" ? "product" : "service", catalog.page + 1)}>Siguiente</Link>}
          </div>
        </div>
      )}
    </MotionSection>
  );
}
