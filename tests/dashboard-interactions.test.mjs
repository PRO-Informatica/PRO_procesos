import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as details from "../src/features/dashboard/details.ts";
import * as formatters from "../src/features/dashboard/formatters.ts";
import * as aging from "../src/features/dashboard/reinvoicing-aging.ts";

const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
function component(path, extra = {}, reduced = false) {
  const states = []; let cursor = 0;
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], value => { states[i] = value; }]; }, useMemo: fn => fn(), useId: () => "test-id", useRef: value => ({ current: value }) },
    "next/link": { __esModule: true, default: "Link" },
    "lucide-react": {},
    "@/components/ui/pagination": { Pagination: "Pagination" },
    "motion/react": { motion: new Proxy({}, { get: (_, key) => `motion.${key}` }), useReducedMotion: () => reduced, useInView: () => true },
    "@/lib/motion/tokens": { motionTokens: { duration: { progress: 1, route: 0.2 }, ease: "easeOut" } },
    "../details": details, "../formatters": formatters,
    "@/lib/status-labels": { formatStatusLabel: String },
    "@/components/motion/motion-page": { MotionPage: "MotionPage" },
    "@/components/ui/badge": { Badge: "Badge" },
    ...extra,
  };
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Infinity, requestAnimationFrame: (callback) => callback(), require(name) { assert.ok(Object.hasOwn(imports, name), `Missing import: ${name}`); return imports[name]; } });
  return Object.fromEntries(Object.entries(exports).map(([name, value]) => [name, typeof value === "function" ? (...args) => { cursor = 0; return value(...args); } : value]));
}

const charts = () => component("features/dashboard/components/dashboard-charts.tsx", {
  recharts: Object.fromEntries(["Bar", "BarChart", "CartesianGrid", "Cell", "LabelList", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, name])),
  "./dashboard-charts.module.css": { __esModule: true, default: { barLink: "barLink", barGlow: "barGlow" } },
});
const linkFromShape = (bar, index = 0) => {
  const shape = bar.props.shape({ x: 0, y: 5, width: 30, height: 60, fill: "red", index });
  return shape.type(shape.props);
};

test("las barras y tarjetas abren el mismo estado del lote, incluso después de cambiar de lote", () => {
  const { BatchReconciliationChart } = charts();
  const props = { projectId: "project-a", batches: [
    { batchId: "old", batchCode: "Lote anterior", pendingInvoices: 1, pendingReconciliation: 2, reinvoicing: 3, reconciled: 4 },
    { batchId: "new", batchCode: "Lote actual", pendingInvoices: 0, pendingReconciliation: 0, reinvoicing: 6, reconciled: 0 },
  ] };
  let tree = BatchReconciliationChart(props);
  const findBar = () => nodes(tree).find(node => node.type === "Bar");
  let barLink = linkFromShape(findBar(), 2);
  assert.equal(barLink.type, "Link");
  assert.match(barLink.props["aria-label"], /6 despachos.*Refacturación.*Lote actual/);
  assert.equal(barLink.props.href, details.dashboardDetailHref("project-a", "reinvoicing", { batch: "new" }));
  nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: "old" } });
  tree = BatchReconciliationChart(props);
  barLink = linkFromShape(findBar(), 2);
  assert.match(barLink.props["aria-label"], /3 despachos.*Lote anterior/);
  const stats = nodes(tree).filter(node => typeof node.type === "function" && node.props.label);
  assert.equal(stats.length, 4);
  for (const [index, stat] of stats.entries()) {
    const link = stat.type(stat.props);
    assert.equal(link.type, "Link");
    assert.equal(link.props.href, linkFromShape(findBar(), index).props.href);
  }
  assert.equal(nodes(tree).find(node => node.type === "Link" && node.props.children === "Ver despachos del lote").props.href,
    details.dashboardDetailHref("project-a", "orders", { batch: "old" }));
});

test("las series diarias distinguen programaciones y guías con enlaces accesibles", () => {
  const { WeeklyVolumeChart } = charts();
  const tree = WeeklyVolumeChart({ projectId: "project-a", days: [{ date: "2026-11-17", shortLabel: "mar", programmedM3: 12, receivedM3: 8 }] });
  const bars = nodes(tree).filter(node => node.type === "Bar");
  for (const [index, view] of ["programmedDay", "receivedDay"].entries()) {
    const href = details.dashboardDetailHref("project-a", view, { date: "2026-11-17" });
    assert.equal(linkFromShape(bars[index]).props.href, href);
    // Text links remain available for keyboard/touch users and zero-height bars.
    assert.ok(nodes(tree).some(node => node.type === "Link" && node.props.href === href));
  }
});

test("la antigüedad comienza en la hora de la solicitud y conserva casos anteriores al periodo", () => {
  const asOf = Date.parse("2026-11-18T18:00:00Z");
  const recent = asOf - 2.5 * aging.DAY_MS;
  const points = aging.dispatchAgingSamples(asOf, 7, recent);
  assert.equal(points[0].age, null);
  assert.equal(points.find(({ time }) => time === recent).age, 0);
  assert.equal(points.at(-1).age, 2.5);
  const overview = aging.projectAgingSamples(asOf, 7, [
    { startedAt: recent }, { startedAt: asOf - 48 * aging.DAY_MS }, { startedAt: null },
  ]);
  assert.deepEqual(overview[0], { time: asOf - 7 * aging.DAY_MS, average: 41, longest: 41 });
  assert.deepEqual(overview.at(-1), { time: asOf, average: 25.25, longest: 48 });
  assert.equal(aging.formatReinvoicingAge(2.5 * aging.DAY_MS), "2 d 12 h");
  assert.equal(aging.formatReinvoicingAge(0), "Menos de 1 h");
  assert.equal(aging.agingPlotLimit(asOf, [{ startedAt: null }]), 14);
  assert.equal(aging.agingPlotLimit(asOf, [{ startedAt: asOf - 48 * aging.DAY_MS }]), 49);
});

test("la vista general incluye todos los casos, y la vista individual grafica solo el despacho seleccionado", () => {
  const { ReinvoicingAgingChart } = component("features/dashboard/components/reinvoicing-aging-chart.tsx", {
    recharts: Object.fromEntries(["Line", "LineChart", "CartesianGrid", "ReferenceLine", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, name])),
    "./dashboard-charts.module.css": { __esModule: true, default: {} },
    "../reinvoicing-aging": aging,
  }, true);
  const asOf = Date.parse("2026-11-18T18:00:00Z");
  const cases = Array.from({ length: 10 }, (_, i) => ({
    id: `id${i}`, code: `DSP-${i}`, programmingCode: "PRG-1", startedAt: i < 9 ? asOf - (10 - i) * aging.DAY_MS : null,
    requests: [{ kind: "Servicio", startedAt: i < 9 ? asOf - (10 - i) * aging.DAY_MS : null }],
  }));
  const props = { data: { asOf, cases }, timezone: "America/Guatemala" };
  let tree = ReinvoicingAgingChart(props);
  assert.deepEqual(nodes(tree).filter(({ type }) => type === "Line").map(({ props }) => props.dataKey), ["average", "longest"]);
  assert.equal(nodes(tree).find(({ type }) => type === "LineChart").props.data.at(-1).average, 6);
  const marker = (id) => nodes(tree).find(({ props }) => props["aria-label"]?.startsWith(`Consultar punto de DSP-${id},`));
  assert.equal(marker(3).props.style.left, "50%");
  assert.match(marker(3).props.className, /text-destructive/u);
  assert.doesNotMatch(marker(4).props.className, /text-destructive/u);
  marker(3).props.onClick();
  tree = ReinvoicingAgingChart(props);
  assert.equal(marker(3).props["aria-pressed"], true);
  assert.ok(nodes(tree).some(({ type, props }) => type === "Link" && props.href === "/dispatches/id3"));
  assert.equal(nodes(tree).filter(({ type }) => type === "Line").length, 2);
  const pagination = nodes(tree).find(({ type }) => type === "Pagination");
  assert.equal(pagination.props.total, 10);
  pagination.props.onPageChange(2);
  tree = ReinvoicingAgingChart(props);
  assert.equal(marker(9), undefined);
  nodes(tree).find(({ props }) => props["aria-label"] === "Ver detalle de DSP-8").props.onClick();
  tree = ReinvoicingAgingChart(props);
  nodes(tree).find(({ type }) => type === "select").props.onChange({ target: { value: "7" } });
  tree = ReinvoicingAgingChart(props);
  const lines = nodes(tree).filter(({ type }) => type === "Line");
  assert.deepEqual(lines.map(({ props }) => props.name), ["DSP-8"]);
  assert.ok(lines.every(({ props }) => !props.isAnimationActive));
  assert.equal(nodes(tree).find(({ type }) => type === "LineChart").props.data[0].time, asOf - 7 * aging.DAY_MS);
  assert.ok(nodes(tree).some(({ type, props }) => type === "Link" && props.href === "/dispatches/id8"));
  const selectDispatch = nodes(tree).filter(({ type }) => type === "select")[1];
  assert.equal(nodes(selectDispatch).filter(({ type }) => type === "option").length, 10);
  selectDispatch.props.onChange({ target: { value: "id9" } });
  tree = ReinvoicingAgingChart(props);
  assert.ok(nodes(tree).some(({ type, props }) => type === "Link" && props.href === "/dispatches/id9"));
  assert.equal(nodes(tree).filter(({ type }) => type === "Line").length, 0);
});

test("Conciliación reutiliza la tabla, pagina de diez en diez y filtra Producto o Servicio", () => {
  const { ReconciliationWorkspace } = component("features/reconciliation/components/reconciliation-workspace.tsx", {
    "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
    "@/components/motion/motion-section": { MotionSection: "MotionSection" },
    "@/components/ui/badge": { StatusBadge: "StatusBadge" },
    "@/features/batches/formatters": { formatBatchQuantity: String },
    "@/features/dashboard/components/indicator-filter": { IndicatorFilter: "IndicatorFilter" },
    "./service-reconciliation-summary": { ServiceReconciliationSummaryCard: "ServiceSummary" },
  });
  const props = { project: { name: "ACOAT" }, data: { batches: [{ id: "batch", code: "LOT" }], items: Array.from({ length: 14 }, (_, index) => ({
    id: `d${index}`, dispatchId: `d${index}`, programmingCode: `PRG-${index}`, orderNumber: String(index), supplierName: "Proveedor", batchIds: ["batch"], batchId: "batch", batchCode: "LOT", billingStatus: index === 13 ? "reconciled" : "reinvoicing",
  })) } };
  let tree = ReconciliationWorkspace(props);
  const rows = () => nodes(tree).filter(node => node.type === "tr" && node.props.className);
  assert.equal(rows().length, 10);
  const pagination = () => nodes(tree).find(node => node.type === "Pagination").props;
  assert.equal(pagination().page, 1);
  assert.equal(pagination().pageSize, 10);
  assert.equal(pagination().total, 14);
  pagination().onPageChange(2);
  tree = ReconciliationWorkspace(props);
  assert.equal(rows().length, 4);
  assert.equal(pagination().page, 2);
  nodes(tree).find(node => node.props?.["aria-label"] === "Filtrar por estado del despacho").props.onChange({ target: { value: "reconciled" } });
  tree = ReconciliationWorkspace(props);
  assert.equal(rows().length, 1);
  assert.equal(nodes(rows()[0]).find(node => node.type === "Link").props.href, "/dispatches/d13");
  tree = ReconciliationWorkspace({ ...props, dashboardScope: { recordIds: ["d0", "d1"], label: "Refacturación" } });
  assert.equal(rows().length, 0); // User's additional filter cannot escape the indicator's selection.
});

test("el indicador conserva el lote anterior en el filtro y la acción de conciliación", () => {
  const { ReconciliationWorkspace } = component("features/reconciliation/components/reconciliation-workspace.tsx", {
    "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
    "@/components/motion/motion-section": { MotionSection: "MotionSection" },
    "@/components/ui/badge": { StatusBadge: "StatusBadge" },
    "@/features/batches/formatters": { formatBatchQuantity: String },
    "@/features/dashboard/components/indicator-filter": { IndicatorFilter: "IndicatorFilter" },
    "./service-reconciliation-summary": { ServiceReconciliationSummaryCard: "ServiceSummary" },
  });
  const tree = ReconciliationWorkspace({ project: { name: "ACOAT" },
    dashboardScope: { recordIds: ["dispatch"], batchId: "old", label: "Refacturación" },
    data: { batches: [{ id: "old", code: "LOT anterior" }, { id: "new", code: "LOT actual" }], items: [{
      id: "dispatch", dispatchId: "dispatch", programmingCode: "PRG", orderNumber: "1", supplierName: "Proveedor",
      batchIds: ["old", "new"], batchId: "new", batchCode: "LOT actual", billingStatus: "reinvoicing",
    }] },
  });
  assert.equal(nodes(tree).find(node => node.props?.["aria-label"] === "Filtrar por lote").props.value, "old");
  const actions = nodes(tree).filter(node => typeof node.type === "function" && node.type.name === "ReconciliationAction");
  assert.equal(actions.length, 2); // Desktop and mobile reuse the same action.
  for (const action of actions) assert.equal(action.type(action.props).props.href, "/batches/old");
  const labels = nodes(tree).filter(node => node.type === "p").map(node => JSON.stringify(node.props.children));
  assert.ok(labels.some(label => label.includes("LOT anterior")));
  assert.ok(labels.every(label => !label.includes("LOT actual")));
});

test("la animación continua es opcional y respeta el movimiento reducido", () => {
  for (const reduced of [false, true]) {
    const { AnimatedProgress } = component("components/feedback/animated-progress.tsx", {}, reduced);
    for (const continuous of [false, true]) {
      const tree = AnimatedProgress({ value: 42, label: "Cumplimiento", continuous });
      assert.equal(tree.props["aria-valuenow"], 42);
      const fill = nodes(tree).find(node => node.type === "motion.div");
      assert.equal(fill.props.animate.scaleX, 0.42);
      const glow = nodes(tree).find(node => node.type === "motion.span");
      assert.equal(Boolean(glow), continuous && !reduced);
      if (glow) assert.equal(glow.props.transition.repeat, Infinity);
    }
  }
});

test("los indicadores reutilizan las rutas existentes y los enlaces antiguos redirigen", async () => {
  for (const view of Object.keys(details.DASHBOARD_DETAILS)) {
    const url = new URL(details.dashboardDetailHref("project-a", view), "http://localhost");
    assert.equal(url.pathname, details.dashboardDestination(view));
    assert.equal(url.searchParams.get("dashboard"), view);
  }
  const { default: page } = component("app/(dashboard)/dashboard/details/page.tsx", {
    "next/navigation": { redirect: href => { throw Object.assign(new Error("redirect"), { href }); } },
    "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
    "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "user" }) },
    "@/features/projects/queries": { getProjectContext: async () => ({ status: "ready", activeProject: { id: "project-a" }, roleCodes: ["PURCHASING"], permissions: ["dispatch.view", "invoice.view", "batch.view"] }) },
    "@/features/dashboard/details": details,
  });
  assert.equal((await page({ searchParams: Promise.resolve({ project: "other", view: "reinvoicing" }) })).type, "EmptyState");
  await assert.rejects(page({ searchParams: Promise.resolve({ project: "project-a", view: "reinvoicing", batch: "batch" }) }), error => error.href === "/reconciliation?project=project-a&dashboard=reinvoicing&batch=batch");
});

test("el filtro del indicador valida rol, proyecto, destino y lote antes de mostrar registros", async () => {
  let calls = 0;
  const { getDashboardListScope } = component("features/dashboard/list-scope.ts", {
    "server-only": {}, "./details": details,
    "./queries": { getProjectDashboard: async () => { calls++; return { weekDays: [{ date: "2026-11-17" }], batchReconciliation: [{ batchId: "batch", batchCode: "LOT" }], records: [
      { id: "d1", groups: ["reinvoicing"], batchIds: ["batch"] },
      { id: "d2", groups: ["reinvoicing"], batchIds: ["other"] },
      { id: "g1", kind: "guide", href: "/dispatches/d1", groups: ["receivedMonth"], batchIds: [] },
      { id: "g2", kind: "guide", href: "/dispatches/d1", groups: ["receivedMonth"], batchIds: [] },
    ] }; } },
  });
  const context = { activeProject: { id: "project-a", name: "ACOAT" }, roleCodes: ["PURCHASING"], permissions: ["dispatch.view", "invoice.view", "batch.view"] };
  const params = { project: "project-a", dashboard: "reinvoicing", batch: "batch" };
  assert.equal((await getDashboardListScope(params, { ...context, roleCodes: ["SUPERVISOR"] }, "/reconciliation")).status, "error");
  assert.equal((await getDashboardListScope({ ...params, project: "other" }, context, "/reconciliation")).status, "error");
  assert.equal((await getDashboardListScope(params, context, "/dispatches")).status, "error");
  assert.equal(calls, 0);
  const result = await getDashboardListScope(params, context, "/reconciliation");
  assert.deepEqual(Array.from(result.scope.recordIds), ["d1"]);
  assert.equal(result.scope.batchId, "batch");
  assert.match(result.scope.description, /ACOAT.*LOT.*1 registro/);
  const received = await getDashboardListScope({ project: "project-a", dashboard: "receivedMonth" }, context, "/dispatches");
  assert.deepEqual(Array.from(received.scope.recordIds), ["d1"]);
  assert.match(received.scope.description, /2 guía/);
  assert.equal((await getDashboardListScope({ ...params, batch: "foreign" }, context, "/reconciliation")).scope.recordIds.length, 0);
});

test("las barras crecen con resorte sin parpadear ni cambiar su valor; movimiento reducido conserva altura", () => {
  for (const reduced of [false, true]) {
    const { WeeklyVolumeChart } = component("features/dashboard/components/dashboard-charts.tsx", {
      recharts: Object.fromEntries(["Bar", "BarChart", "CartesianGrid", "Cell", "LabelList", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, name])),
      "./dashboard-charts.module.css": { __esModule: true, default: { barBody: "body", barSheen: "sheen" } },
    }, reduced);
    const chart = WeeklyVolumeChart({ projectId: "p", days: [{ date: "2026-11-17", programmedM3: 12, receivedM3: 8 }] });
    const bar = nodes(chart).find(node => node.type === "Bar");
    assert.equal(bar.props.isAnimationActive, false); // Motion owns geometry; no double animation.
    const link = linkFromShape(bar);
    const rect = nodes(link).find(node => node.type === "motion.rect");
    assert.equal(rect.props.animate.y + rect.props.animate.height, 65);
    assert.equal(rect.props.animate.height, 60);
    assert.equal(reduced ? rect.props.initial : rect.props.transition.type, reduced ? false : "spring");
    assert.equal(nodes(link).some(node => node.props?.className === "sheen"), !reduced);
  }
});
