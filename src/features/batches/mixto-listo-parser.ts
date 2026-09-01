export type MixtoListoParsedLine = {
  quantity: number;
  unit_code: string;
  code: string;
  description: string;
};

export type MixtoListoParsedInvoice = {
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  observations_raw: string | null;
  pca_original: string | null;
  lines: MixtoListoParsedLine[];
};

function plain(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeUnit(value: string) {
  const unit = value.trim().toUpperCase().replace("³", "3");
  return unit === "M3" ? "M3" : unit;
}

function decimal(value: string) {
  const compact = value.replace(/\s/g, "");
  const normalized =
    compact.includes(",") && compact.includes(".")
      ? compact.lastIndexOf(",") > compact.lastIndexOf(".")
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "")
      : compact.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isSectionBoundary(value: string) {
  return /^(OBSERVACIONES|SUBTOTAL|TOTAL|IVA|FORMA DE PAGO|AUTORIZACION|FRASES|SUJETO A)/.test(
    plain(value.trim()),
  );
}

export function orderNumberFromMixtoListoPca(value: string | null) {
  const match = value
    ?.trim()
    .toUpperCase()
    .match(/^PCA-[0-9]+-([0-9]+)$/);
  if (!match) return null;
  return match[1].replace(/^0+(?=\d)/, "");
}

export function parseMixtoListoInvoiceText(
  rawText: string,
): MixtoListoParsedInvoice {
  const normalizedText = rawText.replace(/\u00a0/g, " ").replace(/\r/g, "");
  const sourceLines = normalizedText
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
  const pca =
    normalizedText.toUpperCase().match(/PCA-[0-9]+-[0-9]+/)?.[0] ?? null;
  const invoiceNumber =
    normalizedText.match(/(?:^|\n)N[ÚU]MERO:\s*([A-Z0-9-]+)/im)?.[1] ??
    normalizedText.match(/(?:^|\n)FACTURA:\s*([A-Z0-9_-]+)/im)?.[1] ??
    null;
  const dateMatch = normalizedText.match(
    /(?:^|\n)FECHA\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})/im,
  );
  const isoDate = normalizedText.match(
    /(?:^|\n)FECHA:\s*(\d{4}-\d{2}-\d{2})/im,
  )?.[1];
  const invoiceDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`
    : (isoDate ?? null);
  const totalMatch =
    normalizedText.match(
      /TOTAL EN LETRAS:[^\n]*\b([A-Z]{3})\s+([0-9][0-9.,]*)\s*(?:\n|$)/i,
    ) ??
    normalizedText.match(
      /(?:^|\n)TOTAL(?: QA)?:\s*([A-Z]{3})\s+([0-9][0-9.,]*)/im,
    );
  const currency = totalMatch?.[1]?.toUpperCase() ?? null;
  const total = totalMatch ? decimal(totalMatch[2]) : null;
  const subtotalMatch = normalizedText.match(
    /(?:^|\n)SUBTOTAL(?: QA)?:\s*[A-Z]{3}\s+([0-9][0-9.,]*)/im,
  );
  const subtotal = subtotalMatch ? decimal(subtotalMatch[1]) : total;
  const observationsIndex = sourceLines.findIndex((line) =>
    plain(line).includes("OBSERVACIONES"),
  );
  let observations: string | null = null;
  if (observationsIndex >= 0) {
    const first = sourceLines[observationsIndex]
      .replace(/^.*?OBSERVACIONES\s*:?[\s-]*/i, "")
      .trim();
    const values = [first];
    for (
      let index = observationsIndex + 1;
      index < sourceLines.length;
      index += 1
    ) {
      if (isSectionBoundary(sourceLines[index])) break;
      values.push(sourceLines[index]);
      if (values.join(" ").length >= 2000) break;
    }
    observations = values.filter(Boolean).join(" ").trim() || null;
  }
  if (!observations && pca) observations = pca;

  const headerIndex = sourceLines.findIndex((line) => {
    const value = plain(line);
    return (
      value.includes("CANTIDAD") &&
      value.includes("MEDIDA") &&
      value.includes("CODIGO") &&
      value.includes("DESCRIPCION")
    );
  });
  const candidates =
    headerIndex >= 0
      ? sourceLines.slice(
          headerIndex + 1,
          observationsIndex > headerIndex ? observationsIndex : undefined,
        )
      : sourceLines;
  const lines: MixtoListoParsedLine[] = [];
  const row =
    /^([0-9][0-9.,]*)\s+(M(?:3|³)|[A-Z]{1,10})\s+([A-Z0-9][A-Z0-9._/-]*)\s+(.+)$/i;

  for (const candidate of candidates) {
    if (isSectionBoundary(candidate)) break;
    const match = candidate.match(row);
    if (match) {
      const quantity = decimal(match[1]);
      if (!quantity) continue;
      lines.push({
        quantity,
        unit_code: normalizeUnit(match[2]),
        code: match[3].trim().toUpperCase(),
        description: match[4].trim(),
      });
      continue;
    }
    if (lines.length && !/^(PRECIO|DESCUENTO|MONTO|PAGINA)/i.test(candidate)) {
      lines[lines.length - 1].description =
        `${lines[lines.length - 1].description} ${candidate}`.trim();
    }
  }

  return {
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    currency,
    subtotal,
    total,
    observations_raw: observations,
    pca_original: pca,
    lines,
  };
}
