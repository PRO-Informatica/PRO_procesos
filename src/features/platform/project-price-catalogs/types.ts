export type PriceCatalogKind = "PRODUCT" | "SERVICE";
export type PriceCatalogImportMode = "REPLACE" | "UPDATE";

export type PriceCatalogPreviewRow = {
  rowNumber: number;
  code: string;
  reference: string | null;
  description: string | null;
  observations: string | null;
  unitCode: string | null;
  rawUnitCode: string | null;
  price: string;
  errors: string[];
};

export type PriceCatalogPreview = {
  fileName: string;
  catalogKind: PriceCatalogKind;
  rows: PriceCatalogPreviewRow[];
  totalCount: number;
  validCount: number;
  errorCount: number;
};

export type PriceCatalogActionResult =
  | { status: "error"; message: string }
  | ({ status: "success" } & PriceCatalogPreview);

export type PriceCatalogImportResult =
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      insertedCount: number;
      updatedCount: number;
      totalCount: number;
    };

export type ProjectProductPrice = {
  id: string;
  code: string;
  reference: string;
  price: string;
  updatedAt: string;
};

export type ProjectServicePrice = {
  id: string;
  code: string;
  description: string | null;
  observations: string | null;
  unitCode: string | null;
  price: string;
  updatedAt: string;
};

export type PriceCatalogPage<T> = {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
  query: string;
  lastUpdatedAt: string | null;
};

export type ProjectPriceCatalogsData = {
  company: { id: string; name: string };
  project: { id: string; name: string; code: string };
  products: PriceCatalogPage<ProjectProductPrice>;
  services: PriceCatalogPage<ProjectServicePrice>;
};
