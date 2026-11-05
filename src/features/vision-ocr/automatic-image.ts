import { FULL_GUIDE_CROP, validGuideCrop, type GuideCrop, type Point } from "./image-geometry.ts";

export type DocumentBoundary = { crop: GuideCrop; detected: boolean };

// The printed Mixto Listo guide has a substantial red logo in its upper-left
// corner. Only propose a turn when one compact red component clearly dominates.
// This is a local orientation hint; the single Vision response verifies text
// direction afterwards. Never turn an arbitrary photo just because it is tall.
export function detectGuideOrientation(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 40 || height < 40 || width > 600 || height > 600 || data.length !== width * height * 4) return 0;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    mask[i] = Number(r > 125 && r - g > 42 && r - b > 30);
  }
  const connected = maskWindow(mask, width, height, 2, true);
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  const candidates: { count: number; x: number; y: number }[] = [];
  for (let start = 0; start < connected.length; start++) {
    if (!connected[start] || seen[start]) continue;
    let head = 0, tail = 1, count = 0, sx = 0, sy = 0, left = width, right = 0, top = height, bottom = 0;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      if (mask[i]) { count++; sx += x; sy += y; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (next >= 0 && connected[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    const ratio = (right - left + 1) / (bottom - top + 1);
    if (count > mask.length * .001 && count < mask.length * .1 && ratio > .45 && ratio < 2.2) candidates.push({ count, x: sx / count / width, y: sy / count / height });
  }
  candidates.sort((a, b) => b.count - a.count);
  if (!candidates.length || (candidates[1]?.count ?? 0) > candidates[0].count * .65) return 0;
  const { x, y } = candidates[0];
  const scores = [x + y, 1 - y + x, 2 - x - y, y + 1 - x];
  const ordered = scores.map((score, turns) => ({ score, turns })).sort((a, b) => a.score - b.score);
  return ordered[1].score - ordered[0].score > .16 ? ordered[0].turns : 0;
}
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = (points: Point[]) => Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - p.y * points[(i + 1) % points.length].x, 0)) / 2;

function hull(points: Point[]) {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (items: Point[]) => {
    const result: Point[] = [];
    for (const p of items) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// Otsu segmentation separates light paper from a darker surrounding surface.
// It is only a proposal: ambiguous backgrounds keep the complete image.
function paperThreshold(gray: Uint8Array) {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (const value of gray) { histogram[value]++; total += value; }
  let weight = 0, sum = 0, best = 0, threshold = 150;
  for (let value = 0; value < 255; value++) {
    weight += histogram[value]; sum += histogram[value] * value;
    if (!weight || weight === gray.length) continue;
    const score = weight * (gray.length - weight) * (sum / weight - (total - sum) / (gray.length - weight)) ** 2;
    if (score > best) { best = score; threshold = value; }
  }
  return Math.max(105, Math.min(225, threshold + 10));
}

// Closing bridges printed table lines and small dark text within the paper.
// Summed windows keep this O(pixels), including on mobile.
function maskWindow(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean) {
  const stride = width + 1, sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) { sum += mask[y * width + x]; sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + sum; }
  }
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    const sum = sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left];
    result[y * width + x] = Number(dilate ? sum > 0 : sum === (right - left) * (bottom - top));
  }
  return result;
}

/** Bounded analysis raster, longest side <= 600. Never infers text or identity. */
export function detectGuideBoundary(data: Uint8ClampedArray, width: number, height: number): DocumentBoundary {
  const fallback = { crop: FULL_GUIDE_CROP, detected: false };
  if (width < 40 || height < 40 || width > 600 || height > 600 || data.length !== width * height * 4) return fallback;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114);
  const threshold = paperThreshold(gray);
  const mask = maskWindow(maskWindow(gray.map((v) => Number(v >= threshold)), width, height, 2, true), width, height, 2, false);
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  const components: { count: number; boundary: Point[] }[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let tail = 1, head = 0; queue[0] = start; seen[start] = 1;
    const boundary: Point[] = [];
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (next < 0) continue;
        if (!mask[next]) { edge = true; continue; }
        if (!seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
      if (edge) boundary.push({ x, y });
    }
    if (tail > mask.length * .15) components.push({ count: tail, boundary });
  }
  components.sort((a, b) => b.count - a.count);
  // Two substantial sheets must not silently become one cropped guide.
  if (!components.length || components.length > 1) return fallback;
  const main = components[0];
  const polygon = hull(main.boundary);
  if (polygon.length < 4) return fallback;
  const hullArea = area(polygon);
  while (polygon.length > 4) {
    let least = Infinity, remove = 0;
    polygon.forEach((p, i) => {
      const loss = Math.abs(cross(polygon[(i + polygon.length - 1) % polygon.length], p, polygon[(i + 1) % polygon.length]));
      if (loss < least) { least = loss; remove = i; }
    });
    polygon.splice(remove, 1);
  }
  const quadArea = area(polygon);
  if (quadArea < mask.length * .35 || quadArea / hullArea < .94 || main.count / quadArea < .65) return fallback;
  // Start at visual top-left while retaining clockwise winding. Do not guess
  // 90/180-degree text orientation from the paper's aspect ratio.
  const start = polygon.reduce((best, p, i) => p.x / width + p.y / height < polygon[best].x / width + polygon[best].y / height ? i : best, 0);
  const quad = [...polygon.slice(start), ...polygon.slice(0, start)];
  // Require the outside to stay darker beyond a printed border. This rejects
  // white table cells/inner frames on a white sheet as document boundaries.
  const pixel = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? null : gray[Math.min(height - 1, Math.round(y)) * width + Math.min(width - 1, Math.round(x))];
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4], length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / length, ny = -(b.x - a.x) / length;
    let good = 0;
    for (let j = 1; j <= 30; j++) {
      const t = j / 31, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const inside = pixel(x - nx * 4, y - ny * 4), outside = pixel(x + nx * 10, y + ny * 10), far = pixel(x + nx * 16, y + ny * 16);
      if (outside === null || (inside !== null && outside !== undefined && far !== undefined && inside - outside >= 22 && (far === null || inside - far >= 18))) good++;
    }
    if (good < 22) return fallback;
  }
  const cx = quad.reduce((n, p) => n + p.x, 0) / 4, cy = quad.reduce((n, p) => n + p.y, 0) / 4;
  // A small outward margin protects text printed right up to the paper edge.
  const crop = quad.map((p) => ({ x: Math.max(0, Math.min(1, (cx + (p.x - cx) * 1.025) / (width - 1))), y: Math.max(0, Math.min(1, (cy + (p.y - cy) * 1.025) / (height - 1))) })) as GuideCrop;
  if (!validGuideCrop(crop) || area(crop) > .97) return fallback;
  return { crop, detected: true };
}

export type ContrastChoice = { apply: boolean; gain: number; reason: "LOW_CONTRAST" | "KEEP_COLOR" | "ALREADY_CLEAR" | "UNSAFE_LIGHTING" };
/** A conservative local heuristic, not a claim about OCR accuracy. */
export function chooseGuideContrast(data: Uint8ClampedArray): ContrastChoice {
  const histogram = new Uint32Array(256);
  let color = 0, count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    histogram[Math.round(r * .299 + g * .587 + b * .114)]++; count++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 35) color++;
  }
  const keep = (reason: ContrastChoice["reason"]): ContrastChoice => ({ apply: false, gain: 1, reason });
  if (!count) return keep("UNSAFE_LIGHTING");
  // Colored copy forms and colored ink keep their original channels.
  if (color / count > .025) return keep("KEEP_COLOR");
  const percentile = (fraction: number) => {
    let sum = 0;
    for (let i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= count * fraction) return i; }
    return 255;
  };
  const low = percentile(.03), high = percentile(.95);
  if (high - low < 10 || high < 145 || low < 70) return keep("UNSAFE_LIGHTING");
  if (high - low >= 100) return keep("ALREADY_CLEAR");
  return { apply: true, gain: Math.min(1.35, 100 / (high - low)), reason: "LOW_CONTRAST" };
}
