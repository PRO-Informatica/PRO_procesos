import { NextResponse, type NextRequest } from "next/server";
import { requireActiveProfile } from "@/features/auth/queries";
import { getCastingRadar } from "@/features/reports/radar-queries";
import { MAX_RADAR_DISPATCHES, parseRadarFilters, selectRadarDispatches } from "@/features/reports/radar";
import { buildRadarWorkbook } from "@/features/reports/radar-workbook";
import { getRadarProjectScope } from "@/features/reports/report-scope";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = await requireActiveProfile();
  const projects = await getRadarProjectScope(profile.id, request.nextUrl.searchParams.get("scope") === "universal");
  if (!projects.length) return NextResponse.json({ message: "No tienes acceso a este reporte." }, { status: 403 });
  let requested: unknown;
  try {
    const body = await request.json();
    requested = body.dispatchIds;
    // Reject malformed selections before querying or generating an Excel.
    if (!Array.isArray(requested) || !requested.length || requested.length > MAX_RADAR_DISPATCHES || requested.some((id) => typeof id !== "string")) throw new Error();
  } catch {
    return NextResponse.json({ message: `Selecciona entre 1 y ${MAX_RADAR_DISPATCHES} despachos.` }, { status: 400 });
  }
  const filters = parseRadarFilters(request.nextUrl.searchParams);
  const data = await getCastingRadar(projects, filters);
  let selected;
  try {
    selected = selectRadarDispatches(data.dispatches, requested);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Selección no disponible." }, { status: 400 });
  }
  const workbook = buildRadarWorkbook(selected);
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="radar-fundicion-${filters.dateFrom}-${filters.dateTo}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
