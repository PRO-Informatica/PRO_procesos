import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const page = await read("../src/app/(dashboard)/batches/universal/page.tsx");
const detailRoute = await read("../src/app/api/batches/universal/detail/route.ts");
const projectRoute = await read("../src/app/api/batches/universal/project/route.ts");
const workspace = await read("../src/features/batches/components/universal-batches-workspace.tsx");
const queries = await read("../src/features/batches/queries.ts");
const actions = await read("../src/features/batches/actions.ts");
const projectQueries = await read("../src/features/projects/queries.ts");
const sidebar = await read("../src/components/layout/app-sidebar.tsx");
const detail = await read("../src/features/batches/components/batch-detail-view.tsx");
const motionPage = await read("../src/components/motion/motion-page.tsx");
const motionSection = await read("../src/components/motion/motion-section.tsx");
const projectActions = await read("../src/features/projects/actions.ts");
const dialogs = await read("../src/features/batches/components/batch-dialogs.tsx");
const invoiceDialogs = await read("../src/features/batches/components/invoice-dialogs.tsx");

test("Lotes Universal aparece como módulo adicional sin reemplazar Lotes", () => {
  assert.match(sidebar, /label: "Lotes"[\s\S]*href: "\/batches"/u);
  assert.match(sidebar, /label: "Lotes Universal"[\s\S]*href: "\/batches\/universal"/u);
});

test("el acceso exige Compras o Company Admin y batch.view por proyecto", () => {
  assert.match(queries, /permissions\.includes\("batch\.view"\)/u);
  assert.match(queries, /\["PURCHASING", "COMPANY_ADMIN"\]\.includes\(role\)/u);
  assert.match(detailRoute, /getUniversalBatchScope\(profile\.id, projectId\)/u);
  assert.match(projectRoute, /getUniversalBatchScope\(profile\.id, projectId\)/u);
});

test("la carga inicial obtiene solo resúmenes multi-proyecto sin detalle ni N+1 de datos", () => {
  assert.match(page, /getUniversalBatchOverview\(scopes\)/u);
  assert.doesNotMatch(page, /getBatchDetail|searchParams/u);
  const start = queries.indexOf("export async function getUniversalBatchOverview");
  const end = queries.indexOf("export async function getBatchDetail", start);
  const implementation = queries.slice(start, end);
  assert.match(implementation, /Promise\.all/u);
  assert.match(implementation, /\.in\("project_id", projectIds\)/u);
  assert.doesNotMatch(implementation, /getBatchPageData/u);
});

test("seleccionar un lote usa estado local y no cambia cookie, URL ni layout", () => {
  assert.match(workspace, /setSelected\(next\)/u);
  assert.match(workspace, /\/api\/batches\/universal\/detail/u);
  assert.doesNotMatch(workspace, /switchProject|useActionState|returnTo|<form/u);
  assert.doesNotMatch(page, /redirect|switchProject/u);
});

test("el endpoint revalida usuario, proyecto, rol y permiso antes del detalle", () => {
  assert.match(detailRoute, /requireActiveProfile\(\)/u);
  assert.match(detailRoute, /getUniversalBatchScope/u);
  assert.match(detailRoute, /getBatchDetail[\s\S]*includeSecondary: false/u);
  assert.match(projectQueries, /getOperationalProjectAccessForProject/u);
});

test("el detalle principal paraleliza consultas y omite documentos e historial secundario", () => {
  const start = queries.indexOf("export async function getBatchDetail");
  const end = queries.indexOf("export async function getBatchSecondaryData", start);
  const implementation = queries.slice(start, end);
  assert.match(implementation, /Promise\.all/u);
  assert.match(implementation, /includeSecondary/u);
  assert.match(implementation, /stageCount: 2/u);
  assert.doesNotMatch(implementation, /invoice_documents|document_versions|document_processing_jobs|invoice_extractions/u);
});

test("historial y preview se cargan bajo demanda", () => {
  assert.match(detail, /loadSecondary/u);
  assert.match(detail, /ensureSecondary/u);
  assert.match(detail, /toggleHistory/u);
  assert.match(detail, /openRollover/u);
  assert.match(detailRoute, /section === "secondary"/u);
  assert.match(detailRoute, /getBatchSecondaryData/u);
});

test("volver a un lote reutiliza cache y los cambios invalidan solo lote y proyecto afectados", () => {
  assert.match(workspace, /new Map<string, BatchDetail>/u);
  assert.match(workspace, /cacheHit: true/u);
  assert.match(workspace, /requests: 0/u);
  assert.match(workspace, /detailCache\.current\.delete/u);
  assert.match(workspace, /Promise\.all\([\s\S]*loadCore[\s\S]*\/api\/batches\/universal\/project/u);
  assert.match(workspace, /AbortController/u);
});

test("las acciones sensibles revalidan el proyecto y permiso en servidor", () => {
  assert.match(actions, /requireActiveProfile\(\)/u);
  assert.match(actions, /getOperationalProjectAccessForProject\(profile\.id, projectId\)/u);
  assert.match(actions, /scope\?\.permissions\.includes\(permission\)/u);
});

test("los diálogos embebidos notifican cambios sin forzar router.refresh", () => {
  assert.match(detail, /onDataChanged/u);
  assert.match(dialogs, /onSuccess\?: \(\) => void \| Promise<void>/u);
  assert.match(dialogs, /if \(onSuccess\) await onSuccess\(\); else router\.refresh\(\)/u);
  assert.match(invoiceDialogs, /if \(onSuccess\) await onSuccess\(\);/u);
});

test("la vista conserva carrusel, scroll acotado, puntero y animación", () => {
  assert.match(workspace, /snap-x snap-mandatory/u);
  assert.match(workspace, /overflow-x-auto overscroll-x-contain/u);
  assert.match(workspace, /batches\.length > 3/u);
  assert.match(workspace, /cursor-pointer/u);
  assert.match(workspace, /whileHover/u);
  assert.match(workspace, /whileTap/u);
  assert.match(workspace, /AnimatePresence mode="wait"/u);
});

test("el detalle embebido se renderiza nítido sin opacidades animadas anidadas", () => {
  assert.match(motionPage, /disableMotion/u);
  assert.match(detail, /<MotionPage disableMotion=\{embedded\}/u);
  assert.match(motionSection, /disableMotion/u);
  assert.equal((detail.match(/<MotionSection disableMotion=\{embedded\}/gu) ?? []).length, 3);
  assert.match(workspace, /selectedDetail\.id\} initial=\{false\}/u);
  assert.doesNotMatch(workspace, /selectedDetail\.id\}[\s\S]{0,120}opacity:/u);
});

test("abrir un despacho de otro proyecto cambia el contexto y conserva la ruta exacta", () => {
  assert.match(detail, /function DispatchDetailLink/u);
  assert.match(detail, /context\.activeProject\?\.id !== projectId/u);
  assert.match(detail, /name="projectId" value=\{projectId\}/u);
  assert.match(detail, /name="returnTo" value=\{href\}/u);
  assert.ok(projectActions.includes('/^\\/dispatches\\/[0-9a-f-]{36}$/i.test(returnTo)'));
  assert.match(projectActions, /universalBatchReturn \?\? dispatchDetailReturn/u);
});
