import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../src/app/(dashboard)/reports/universal/page.tsx");
const route = await read("../src/app/(dashboard)/reports/export/route.ts");
const queries = await read("../src/features/reports/queries.ts");
const accessPolicy = await read("../src/features/projects/access-policy.ts");
const tableRows = await read("../src/features/reports/components/report-table-rows.tsx");
const scopedLink = await read("../src/features/reports/components/project-scoped-report-link.tsx");
const sidebar = await read("../src/components/layout/app-sidebar.tsx");
const filtersView = await read("../src/features/reports/components/report-filters.tsx");
const legacyPage = await read("../src/app/(dashboard)/reports/page.tsx");
const scope = await read("../src/features/reports/report-scope.ts");
const projectQueries = await read("../src/features/projects/queries.ts");

test("Reportería Universal es el único módulo de reportes y la ruta anterior redirige", () => {
  assert.doesNotMatch(sidebar, /href: "\/reports"/u);
  assert.match(legacyPage, /redirect\(`/u);
  assert.match(legacyPage, /reports\/universal/u);
  assert.match(sidebar, /label: "Reportería Universal"[\s\S]*href: "\/reports\/universal"/u);
});

test("el acceso universal de lectura admite Compras, Company Admin o Platform Admin", () => {
  assert.match(queries, /export async function getUniversalReportScopes/u);
  assert.match(queries, /permissions\.includes\("dispatch\.view"\)/u);
  assert.match(queries, /hasUniversalOperationalViewRole\(roleCodes\)/u);
  assert.match(accessPolicy, /"PURCHASING", "COMPANY_ADMIN", "PLATFORM_ADMIN"/u);
  assert.match(page, /getUniversalReportScopes\(profile\.id\)/u);
  assert.match(projectQueries, /hasUniversalReportAccess/u);
});

test("la vista consulta todos los proyectos autorizados y conserva el filtro por proyecto", () => {
  assert.match(page, /const projects = scopes\.map/u);
  assert.match(page, /billingLegalName: project\.billingLegalName/u);
  assert.match(page, /getGuideReport\(projects, filters, \{ mixtoListoOnly: true \}\)/u);
  assert.match(page, /<GuideReport[^>]*universal/u);
  assert.match(filtersView, /name="project" label="Proyecto · compañía"/u);
  assert.doesNotMatch(filtersView, /name="supplier"|name="programmingStatus"/u);
});

test("Excel y ZIP revalidan el alcance universal en servidor", () => {
  assert.match(route, /const universal = true/u);
  assert.doesNotMatch(route, /getProjectContext|canAccessOperationalSection/u);
  assert.match(scope, /getUniversalReportScopes\(userId\)/u);
  assert.doesNotMatch(scope, /getProjectContext/u);
  assert.match(route, /await getUniversalReportScopes\(profile\.id\)/u);
  assert.match(route, /getGuideReport\(projects\.map/u);
  assert.match(route, /buildWorkbook\(report,/u);
  assert.match(route, /buildZip\(report, universal \|\| projects\.length > 1\)/u);
});

test("los enlaces de otro proyecto cambian el contexto antes de abrir el detalle", () => {
  assert.match(tableRows, /<ProjectScopedReportLink projectId=\{dispatch\.projectId\} href=\{/u);
  assert.match(scopedLink, /context\.activeProject\?\.id !== projectId/u);
  assert.match(scopedLink, /name="projectId" value=\{projectId\}/u);
  assert.match(scopedLink, /name="returnTo" value=\{href\}/u);
});
