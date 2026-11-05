export type Point = { x: number; y: number };
export type GuideCrop = [Point, Point, Point, Point]; // TL, TR, BR, BL, relative to rotated image
export const FULL_GUIDE_CROP: GuideCrop = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export function validGuideCrop(points: GuideCrop) {
  if (points.length !== 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  const crosses = points.map((p, i) => {
    const q = points[(i + 1) % 4], r = points[(i + 2) % 4];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  const area = Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0)) / 2;
  return crosses.every((c) => c > 0.0001) && area > 0.06;
}
