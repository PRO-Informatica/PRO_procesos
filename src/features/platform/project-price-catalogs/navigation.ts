import type { PriceCatalogKind } from "./types";

export function catalogHrefAfterImport(currentHref: string, kind: PriceCatalogKind) {
  const url = new URL(currentHref);
  url.searchParams.delete(kind === "PRODUCT" ? "productPage" : "servicePage");
  // Keep the other catalog's pagination, both searches and the current anchor.
  return `${url.pathname}${url.search}${url.hash}`;
}
