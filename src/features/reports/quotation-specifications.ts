type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const identifier = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toUpperCase().replace(/[\s.]+/gu, "");
const key = (project: unknown, code: unknown, reference: unknown) => JSON.stringify([text(project), identifier(code), identifier(reference)]);

function uniqueProduct(products: Row[]) { return products.length === 1 ? products[0] : undefined; }

// Technical quotation metadata may complete old guides. Commercial snapshots stay intact.
export function withQuotationSpecifications(lines: Row[], products: Row[], concreteTypesByGuide: ReadonlyMap<string, readonly string[]> = new Map()): Row[] {
  const byId = new Map(products.map((product) => [text(product.id), product]));
  const byProject = new Map<string, Row[]>();
  for (const product of products) {
    const project = text(product.project_id);
    byProject.set(project, [...(byProject.get(project) ?? []), product]);
  }
  return lines.map((line) => {
    if (line.catalog_type === "SERVICE" || !text(line.project_id)) return line;
    const catalog = byProject.get(text(line.project_id)) ?? [];
    const candidate = text(line.product_price_id) ? byId.get(text(line.product_price_id)) : undefined;
    const code = identifier(line.product_code), reference = identifier(line.catalog_reference);
    let product = candidate?.project_id === line.project_id ? candidate : uniqueProduct(catalog.filter((product) => key(product.project_id, product.code, product.reference) === key(line.project_id, line.product_code, line.catalog_reference)));
    // Legacy guides sometimes saved only a code or a reference. Never match by PSI alone.
    if (!product && (!code || !reference) && (code || reference)) {
      const value = code || reference;
      product = uniqueProduct(catalog.filter((entry) => identifier(entry.code) === value || identifier(entry.reference) === value));
    }
    let fromProgramming = false;
    // A planned concrete can complete an unidentified product, but cannot replace an
    // explicit different concrete in a guide, assign services or resolve ambiguity.
    if (!product && !code && !reference && /^m[3³]$/iu.test(text(line.unit_code))) {
      const types = [...new Set((concreteTypesByGuide.get(text(line.guide_id)) ?? []).map(identifier).filter(Boolean))];
      if (types.length === 1) {
        product = uniqueProduct(catalog.filter((entry) => identifier(entry.code) === types[0] || identifier(entry.reference) === types[0]));
        fromProgramming = !!product;
      }
    }
    if (!product) return line;
    return {
      ...line, resistance_psi: product.resistance_psi ?? null, slump: product.slump ?? null,
      quotation_unit_price: product.price ?? null,
      quotation_reference: text(product.reference),
      quotation_from_programming: fromProgramming,
    };
  });
}
