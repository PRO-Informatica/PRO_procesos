import "server-only";

import { extractText, extractTextItems, getDocumentProxy } from "unpdf";

import { parseMixtoListoInvoiceText } from "./mixto-listo-parser";

function linesFromItems(items: Awaited<ReturnType<typeof extractTextItems>>["items"]) {
  return items.flatMap((page) => {
    const ordered = [...page].sort((left, right) => {
      if (Math.abs(left.y - right.y) > 2) return right.y - left.y;
      return left.x - right.x;
    });
    const rows: Array<{ y: number; values: typeof ordered }> = [];
    for (const item of ordered) {
      const current = rows.find((row) => Math.abs(row.y - item.y) <= 2);
      if (current) current.values.push(item);
      else rows.push({ y: item.y, values: [item] });
    }
    return rows.map((row) => row.values.sort((left, right) => left.x - right.x).map((item) => item.str.trim()).filter(Boolean).join(" "));
  }).filter(Boolean);
}

export async function extractMixtoListoInvoicePdf(buffer: ArrayBuffer) {
  const document = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const [plainResult, itemResult] = await Promise.all([
      extractText(document, { mergePages: true }),
      extractTextItems(document),
    ]);
    const layoutText = linesFromItems(itemResult.items).join("\n");
    const layoutParsed = parseMixtoListoInvoiceText(layoutText);
    if (layoutParsed.lines.length || layoutParsed.pca_original) return layoutParsed;
    return parseMixtoListoInvoiceText(plainResult.text);
  } finally {
    await document.cleanup();
  }
}
