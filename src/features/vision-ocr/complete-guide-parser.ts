import type { GoogleVisionResponse } from "./vision-ocr.ts";
import { normalizeOcrText } from "./guide-parser.ts";
import { emptyGuideDetails, normalizeGuideDate, normalizeGuideTime, normalizeGuideUnit, type GuideOcrDraft } from "./guide-draft.ts";

type Word = { text: string; x: number; y: number; w: number; h: number; confidence: number | null; paragraph: number };
type Label = { name: string; words: Word[]; x: number; y: number; right: number; bottom: number };
const LABELS: Record<string, string[]> = {
  guide: ["GUIA DE DESPACHO"], customerName: ["NOMBRE DEL CLIENTE", "CLIENTE"], projectName: ["PROYECTO"],
  workAddress: ["DIRECCION DE OBRA", "DIRECCION OBRA", "DIRECCION DE"], guideDate: ["FECHA"], orderNumber: ["NO PEDIDO", "PEDIDO NO", "PEDIDO"],
  quantity: ["CANTIDAD"], unit: ["UMM", "UM", "U M"], code: ["CODIGO PRODUCTO", "CODIGO"], description: ["DESCRIPCION PRODUCTO", "DESCRIPCION"],
  plant: ["PLANTA"], truck: ["CAMION"], loadingTime: ["HORA DE CARGA", "HORA CARGA"],
  arrival: ["LLEGA A OBRA", "LLEGA OBRA", "LLEGADA OBRA", "LLEGADA A OBRA"], departure: ["SALE DE OBRA", "SALE OBRA", "SALIDA DE OBRA"],
  plantArrival: ["LLEGA PLANTA"],
  pilot: ["PILOTO"], operator: ["OPERADOR"], observations: ["OBSERVACIONES"],
  signature: ["RECIBE CONFORME"], footer: ["ORIGINAL BLANCO", "ORIGINAL"],
};
const centerX = (word: Word) => word.x + word.w / 2;
const centerY = (word: Word) => word.y + word.h / 2;
const textOf = (words: Word[]) => rows(words).map((row) => row.map((w) => w.text).join(" ")).join(" ").replace(/\s+/gu, " ").trim();
function median(numbers: number[]) { const sorted = [...numbers].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }
function rows(words: Word[]) {
  const result: Word[][] = [];
  const tolerance = Math.max(0.002, median(words.map((w) => w.h)) * 0.65);
  for (const word of [...words].sort((a, b) => centerY(a) - centerY(b))) {
    const row = result.find((row) => Math.abs(median(row.map(centerY)) - centerY(word)) < tolerance);
    if (row) row.push(word); else result.push([word]);
  }
  return result.map((row) => row.sort((a, b) => a.x - b.x));
}

// Use the same Vision response for orientation; never issue another read.
// Quarter-turn voting also handles +179/-179 degrees around the angle boundary.
export function guideReadingTurns(response: GoogleVisionResponse): number {
  const page = response.responses?.[0]?.fullTextAnnotation?.pages?.[0];
  if (!page) return 0;
  const source = (page.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((p) => p.words ?? []));
  const votes = [0, 0, 0, 0];
  for (const word of source) {
    const v = word.boundingBox?.vertices;
    if (!v || v.length < 4 || (word.symbols?.length ?? 0) < 3) continue;
    const angle = Math.atan2((v[1].y ?? 0) - (v[0].y ?? 0), (v[1].x ?? 0) - (v[0].x ?? 0));
    votes[((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4]++;
  }
  const total = votes.reduce((sum, n) => sum + n, 0), best = votes.indexOf(Math.max(...votes));
  return total >= 3 && votes[best] / total >= .6 ? (4 - best) % 4 : 0;
}

// Vision's vertex order describes text direction even for sideways photographs.
export function orientedGuideWords(response: GoogleVisionResponse): Word[] {
  const page = response.responses?.[0]?.fullTextAnnotation?.pages?.[0];
  if (!page?.width || !page.height) return [];
  const source = (page.blocks ?? []).flatMap((b) => b.paragraphs ?? []).flatMap((p, paragraph) => (p.words ?? []).map((w) => ({ ...w, paragraph })));
  const quarter = guideReadingTurns(response) * Math.PI / 2;
  const residuals = source.flatMap((word) => {
    const v = word.boundingBox?.vertices;
    if (!v || v.length < 4 || (word.symbols?.length ?? 0) < 4) return [];
    const angle = Math.atan2((v[1].y ?? 0) - (v[0].y ?? 0), (v[1].x ?? 0) - (v[0].x ?? 0)) + quarter;
    const residual = Math.atan2(Math.sin(angle), Math.cos(angle));
    return Math.abs(residual) < Math.PI / 12 ? [residual] : [];
  });
  // Camera tilt otherwise puts a quantity and its code on different rows.
  // Deskew from the same OCR response; no additional paid read.
  const angle = quarter - (residuals.length >= 5 ? median(residuals) : 0);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rotate = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const corners = [[0, 0], [page.width, 0], [0, page.height], [page.width, page.height]].map(([x, y]) => rotate(x, y));
  const minX = Math.min(...corners.map((p) => p.x)), minY = Math.min(...corners.map((p) => p.y));
  const width = Math.max(...corners.map((p) => p.x)) - minX, height = Math.max(...corners.map((p) => p.y)) - minY;
  return source.flatMap((word) => {
    const text = (word.symbols ?? []).map((s) => s.text ?? "").join("").trim();
    const v = word.boundingBox?.vertices;
    if (!text || !v?.length) return [];
    const points = v.map((p) => rotate(p.x ?? 0, p.y ?? 0));
    const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
    return [{ text, x: (x - minX) / width, y: (y - minY) / height,
      w: (Math.max(...points.map((p) => p.x)) - x) / width,
      h: (Math.max(...points.map((p) => p.y)) - y) / height,
      confidence: typeof word.confidence === "number" ? word.confidence : null, paragraph: word.paragraph }];
  });
}

function findLabels(words: Word[]) {
  const labels: Label[] = [];
  for (const first of words) {
    for (const [name, aliases] of Object.entries(LABELS)) {
      for (const alias of aliases) {
        const parts = alias.split(" ");
        if (normalizeOcrText(first.text) !== parts[0]) continue;
        const matched = [first];
        for (const part of parts.slice(1)) {
          const last = matched.at(-1)!;
          const next = words.filter((w) => w.x >= last.x + last.w - .004 && w.x < last.x + last.w + .035
            && Math.abs(centerY(w) - centerY(last)) < Math.max(w.h, last.h) * .9 && normalizeOcrText(w.text) === part)
            .sort((a, b) => a.x - b.x)[0];
          if (!next) break;
          matched.push(next);
        }
        if (matched.length !== parts.length) continue;
        labels.push({ name, words: matched, x: matched[0].x, y: Math.min(...matched.map((w) => w.y)),
          right: Math.max(...matched.map((w) => w.x + w.w)), bottom: Math.max(...matched.map((w) => w.y + w.h)) });
        break;
      }
    }
  }
  return labels;
}

export function parseCompleteGuide(response: GoogleVisionResponse): GuideOcrDraft {
  let words = orientedGuideWords(response);
  let labels = findLabels(words);
  const warnings: string[] = [];
  const headers = labels.filter((l) => l.name === "guide");
  // Multiple sheets in one photo are unsafe to silently merge.
  if (headers.length > 1) {
    warnings.push("Hay varias guías visibles. Recorta una sola guía antes de continuar; revisa todos los campos.");
    const main = [...headers].sort((a, b) => (b.right - b.x) - (a.right - a.x))[0];
    const next = headers.filter((h) => h.y > main.y + 0.04).sort((a, b) => a.y - b.y)[0];
    words = words.filter((w) => centerY(w) >= main.y - 0.04 && centerY(w) < (next?.y ?? 1));
    labels = findLabels(words);
  }
  // Ignore the operations form/background before and after the primary guide.
  const guideTop = labels.find((l) => l.name === "guide")?.y;
  if (guideTop !== undefined) labels = labels.filter((l) => l.y >= guideTop - .03);
  const tableLeft = labels.find((l) => l.name === "quantity")?.x;
  if (tableLeft !== undefined) labels = labels.filter((l) => !["pilot", "operator"].includes(l.name) || l.x < tableLeft + 0.18);
  labels.sort((a, b) => a.y - b.y);
  labels = labels.filter((l, i) => l.name === "guide" || i === labels.findIndex((other) => other.name === l.name));
  if (!headers.length) warnings.push("No se reconoció el encabezado Guía de despacho. Comprueba que la foto corresponde a una guía.");
  const confidence: Record<string, number | null> = {};
  const label = (name: string) => labels.find((l) => l.name === name);
  const usedPilotParagraphs = new Set<number>();
  const rightColumn = Math.min(...labels.filter((l) => ["plant", "loadingTime", "arrival", "departure"].includes(l.name)).map((l) => l.x), 1) - .025;
  const fieldWords = (name: string, maximumRows = 2): Word[] => {
    const target = label(name);
    if (!target) return [];
    const sameRow = labels.filter((l) => l.name !== name && Math.abs(l.y - target.y) < 0.025 && l.x > target.right + 0.01).sort((a, b) => a.x - b.x)[0];
    // Column bounds are defined by neighboring labels, never by image percentages.
    let right = sameRow?.x ?? 1;
    if (name === "customerName" || name === "projectName") right = label("workAddress")?.x ?? label("orderNumber")?.x ?? right;
    if (name === "workAddress") right = rightColumn < .975 ? rightColumn : label("orderNumber")?.x ?? right;
    if (name === "pilot" || name === "operator") right = label("observations")?.x ?? right;
    if (name === "observations") right = label("signature")?.x ?? right;
    const lower = labels.filter((l) => l.name !== name && l.y > target.bottom + 0.006 && l.x >= target.x - 0.025 && l.x < right - 0.01).sort((a, b) => a.y - b.y)[0];
    const footerY = Math.min(...words.filter((w) => /^(?:ORIGINAL|DUPLICADO|TRIPLICADO|CUADRUPLICADO)$/u.test(normalizeOcrText(w.text)) && w.y > target.y).map((w) => w.y - w.h * .35), 1);
    const bottom = Math.min(lower?.y ?? 1, target.bottom + (name === "observations" ? 0.24 : 0.15), ["observations", "pilot", "operator"].includes(name) ? footerY : 1);
    const left = ["guideDate", "orderNumber", "loadingTime", "arrival", "departure"].includes(name) ? Math.min(target.x - .012, rightColumn) : target.x - .012;
    let region = words.filter((w) => centerX(w) >= left && centerX(w) < right - 0.003 && centerY(w) >= target.y - 0.004 && centerY(w) < bottom - 0.002 && !labels.some((l) => l.words.includes(w)));
    if (name === "pilot") {
      // Names may be printed across the box boundary. Keep the complete OCR
      // paragraph containing the name, without borrowing adjacent observations.
      const paragraphs = new Set(region.map((w) => w.paragraph).filter((p) => !labels.some((l) => l.words.some((w) => w.paragraph === p))));
      region = [...new Set([...region, ...words.filter((w) => paragraphs.has(w.paragraph) && centerY(w) >= target.y - .004 && centerY(w) < bottom - .002)])];
      for (const p of paragraphs) usedPilotParagraphs.add(p);
    }
    if (name === "observations") region = region.filter((w) => !usedPilotParagraphs.has(w.paragraph));
    const selected = rows(region).slice(0, maximumRows).flat();
    const scores = selected.flatMap((w) => w.confidence === null ? [] : [w.confidence]);
    confidence[name] = scores.length ? Math.min(...scores) : null;
    return selected;
  };
  const get = (name: string, count = 2) => textOf(fieldWords(name, count)).replace(/^[\s:;|]+/u, "").trim();
  const details = emptyGuideDetails();
  details.customerName = get("customerName");
  details.projectName = get("projectName");
  details.workAddress = get("workAddress", 4);
  const rawDate = get("guideDate");
  const dateToken = rawDate.match(/\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}/u)?.[0].replace(/\s/gu, "")
    ?? rawDate.match(/\d{1,2}\s+(?:de\s+)?[a-záéíóú]+\s+(?:de\s+)?\d{4}\b|\d{1,2}\s+(?:de\s+)?[a-záéíóú]+\s+(?:de\s+)?\d{2}\b/iu)?.[0] ?? "";
  details.guideDate = normalizeGuideDate(dateToken) ?? "";
  if (rawDate && !details.guideDate) warnings.push(`Fecha por confirmar: ${rawDate}. Se espera día/mes/año.`);
  details.orderNumber = get("orderNumber").match(/\d+/u)?.[0] ?? "";
  details.plant = get("plant", 1);
  details.truck = get("truck", 1);
  details.pilot = get("pilot", 2).replace(/\bOPERADOR.*$/iu, "").trim();
  details.operator = get("operator", 1);
  details.observations = get("observations", 5);
  const guideRaw = get("guide");
  const guideNumber = guideRaw.match(/\d[\d-]{4,}/u)?.[0] ?? "";
  const clock = (name: string) => {
    const raw = get(name, 2);
    return { raw, normalized: normalizeGuideTime(raw) ?? "" };
  };
  const loading = clock("loadingTime"), arrival = clock("arrival"), departure = clock("departure");
  details.loadingTime = loading.normalized;
  const q = label("quantity"), u = label("unit"), c = label("code"), d = label("description");
  const lines: GuideOcrDraft["lines"] = [];
  if (q && u && c && d && q.x < u.x && u.x < c.x && c.x < d.x) {
    const start = Math.max(q.bottom, u.bottom, c.bottom, d.bottom) + 0.003;
    const end = Math.min(...labels.filter((l) => ["pilot", "observations", "operator"].includes(l.name) && l.y > start).map((l) => l.y), 1);
    const content = words.filter((w) => centerY(w) > start && centerY(w) < end && centerX(w) >= q.x - 0.02 && centerX(w) < (label("plant")?.x ?? 1) - 0.01);
    const boundaries = [(q.right + u.x) / 2, (u.right + c.x) / 2, (c.right + d.x) / 2];
    const isCode = (word: Word) => /^(?:\d{5,}|SERV[\dA-Z]+)$/iu.test(word.text);
    const quantityRows = rows(content.filter((w) => centerX(w) < boundaries[0])).map((row) => ({ row, text: textOf(row).replace(/\s/gu, "") })).filter((v) => /^\d+(?:[.,]\d+)?$/u.test(v.text));
    const codeRows = rows(content.filter((w) => centerX(w) >= boundaries[1] && centerX(w) < d.x && isCode(w)));
    // Keep a line even when its quantity is unreadable. Dropping it silently
    // would also drop a service (especially the final line of a mixed guide).
    const anchors = quantityRows.map((value) => ({ ...value, y: median(value.row.map(centerY)) }));
    for (const row of codeRows) {
      const y = median(row.map(centerY));
      if (!anchors.some((anchor) => Math.abs(anchor.y - y) < Math.max(0.012, median(row.map((w) => w.h))))) {
        anchors.push({ row: [], text: "", y });
      }
    }
    const qtys = anchors.sort((a, b) => a.y - b.y);
    for (let i = 0; i < qtys.length; i++) {
      const current = qtys[i];
      const y = current.y;
      const prev = i ? (qtys[i - 1].y + y) / 2 : start;
      const next = i < qtys.length - 1 ? (qtys[i + 1].y + y) / 2 : end;
      const cell = (left: number, right: number) => content.filter((w) => centerX(w) >= left && centerX(w) < right && centerY(w) >= prev && centerY(w) < next);
      const rawUnit = textOf(cell(boundaries[0], boundaries[1]));
      const codeRegion = cell(boundaries[1], d.x);
      const recognizedCode = codeRegion.find(isCode);
      const codeWords = recognizedCode ? [recognizedCode] : cell(boundaries[1], boundaries[2]);
      const productCode = textOf(codeWords).replace(/\s+/gu, "").toUpperCase();
      const scores = [...current.row, ...codeWords].flatMap((w) => w.confidence === null ? [] : [w.confidence]);
      confidence[`line${i}`] = scores.length ? Math.min(...scores) : null;
      const description = textOf(cell(recognizedCode ? recognizedCode.x + recognizedCode.w + 0.002 : boundaries[2], label("plant")?.x ?? 1));
      lines.push({ quantity: current.text.replace(",", "."), unit: normalizeGuideUnit(rawUnit), productCode, description,
        type: productCode.startsWith("SERV") || /^SERVICIO\b/u.test(normalizeOcrText(description)) ? "SERVICE" : "", catalogItemId: "", candidates: [], warning: null });
      if (!current.text) warnings.push(`Línea ${i + 1}: no se leyó la cantidad. Confírmala en la foto.`);
    }
  }
  if (!lines.length) warnings.push("No se identificaron líneas con seguridad. Puedes ingresarlas manualmente desde la foto.");
  for (const [name, value] of Object.entries({ guideNumber, projectName: details.projectName, workAddress: details.workAddress, guideDate: details.guideDate, arrivalTime: arrival.normalized, departureTime: departure.normalized })) {
    if (!value) warnings.push(`Por confirmar: ${name === "guideNumber" ? "número de guía" : name === "projectName" ? "proyecto" : name === "workAddress" ? "dirección de obra" : name === "guideDate" ? "fecha" : name === "arrivalTime" ? "llegada del camión" : "salida del camión"}.`);
  }
  if (Object.values(confidence).some((score) => score !== null && score < 0.8)) warnings.push("Hay lecturas de baja confianza. Compara los campos señalados con la fotografía.");
  return { guideNumber, arrivalTime: arrival.normalized, departureTime: departure.normalized, details, lines,
    rawTimes: { loading: loading.raw, arrival: arrival.raw, departure: departure.raw }, confidence, warnings };
}
