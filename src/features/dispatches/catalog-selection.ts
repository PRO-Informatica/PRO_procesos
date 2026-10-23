import type { DispatchCatalogOption, DispatchCatalogType } from "./types";

export function catalogSelectionDefaults(
  item: DispatchCatalogOption,
  line: { catalogType: DispatchCatalogType | ""; productDescription: string; unitCode: string },
  programmedUnitCode: string,
) {
  if (item.type === "PRODUCT") {
    return { productDescription: item.reference ?? "", unitCode: programmedUnitCode };
  }
  return {
    productDescription: item.description ?? (line.catalogType === "PRODUCT" ? "" : line.productDescription),
    // Do not inherit a different service's commercial unit when metadata is missing.
    unitCode: item.unitCode ?? "",
  };
}
