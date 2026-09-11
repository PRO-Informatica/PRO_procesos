import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../src/app/(dashboard)/reports/universal/page.tsx");
const route = await read("../src/app/(dashboard)/reports/export/route.ts");
const queries = await read("../src/features/reports/queries.ts");
const reportView = await read("../src/features/reports/components/guide-report.tsx");
const scopedLink = await read("../src/features/reports/components/project-scoped-report-link.tsx");
const sidebar = await read("../src/components/layout/app-sidebar.tsx");
const projectQueries = await read("../src/features/projects/queries.ts");

test("Reportería Universal aparece como módulo adicional", () => {
  assert.match(sidebar, /label: "Reportería"[\s\S]*href: "\/reports"[\s\S]*exact: true/u);
  assert.match(sidebar, /label: "Reportería Universal"[\s\S]*href: "\/reports\/universal"/u);
});

test("el acceso universal exige Compras o Company Admin y dispatch.view por proyecto", () => {
  assert.match(queries, /export async function getUniversalReportScopes/u);
  assert.match(queries, /permissions\.includes\("dispatch\.view"\)/u);
  assert.match(queries, /\["PURCHASING", "COMPANY_ADMIN"\]\.includes\(role\)/u);
  assert.match(page, /getUniversalReportScopes\(profile\.id\)/u);
  assert.match(projectQueries, /hasUniversalReportAccess/u);
});

test("la vista consulta todos los proyectos autorizados y conserva el filtro por proyecto", () => {
  assert.match(page, /const projects = scopes\.map/u);
  assert.match(page, /billingLegalName: project\.billingLegalName/u);
  assert.match(page, /getGuideReport\(projects, filters\)/u);
  assert.match(page, /<GuideReport[^>]*universal/u);
  assert.match(reportView, /name="project" label="Proyecto"/u);
});

test("Excel y ZIP revalidan el alcance universal en servidor", () => {
  assert.match(route, /searchParams\.get\("scope"\) === "universal"/u);
  assert.match(route, /await getUniversalReportScopes\(profile\.id\)/u);
  assert.match(route, /getGuideReport\(projects\.map/u);
  assert.match(route, /buildWorkbook\(report,/u);
  assert.match(route, /buildZip\(report, universal \|\| projects\.length > 1\)/u);
});

test("los enlaces de otro proyecto cambian el contexto antes de abrir el detalle", () => {
  assert.match(reportView, /ProjectScopedReportLink/u);
  assert.match(scopedLink, /context\.activeProject\?\.id !== projectId/u);
  assert.match(scopedLink, /name="projectId" value=\{projectId\}/u);
  assert.match(scopedLink, /name="returnTo" value=\{href\}/u);
});
