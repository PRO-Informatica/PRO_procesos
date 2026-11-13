import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as types from "../src/features/programming/types.ts";
import * as availability from "../src/features/programming/availability.ts";
import * as kanbanPolicy from "../src/features/programming/kanban-policy.ts";
import * as access from "../src/features/projects/access-policy.ts";
import * as labels from "../src/lib/status-labels.ts";

function load(path, imports, globals = {}) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl, ...globals, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Missing import: ${name}`);
    return imports[name];
  } });
  return exports;
}

const presentation = load("features/programming/status-presentation.ts", { "../projects/access-policy": access, "./types": types });
const formatters = load("features/programming/formatters.ts", { "@/lib/status-labels": labels, "./status-presentation": presentation });
const colors = load("features/programming/status-colors.ts", { "./status-presentation": presentation });
const jsx = (type, props) => ({ type, props });
const runtime = { jsx, jsxs: jsx };
const baseImports = {
  "react/jsx-runtime": runtime, "lucide-react": {}, "../formatters": formatters,
  "../status-presentation": presentation, "../status-colors": colors, "../types": types,
};
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const timezone = "America/Guatemala";
const item = (status, id = status) => Object.freeze({
  id, status, effectiveStatus: status, version: 2, projectId: "project", supplierId: "supplier",
  supplierName: "Proveedor", scheduledAt: "2026-11-03T13:00:00Z", requestedQuantity: 6.5,
  unitCode: "M3", deliveryModes: ["PUMP"], dispatches: [], lines: [], revisions: [],
  createdAt: "2026-11-03T13:00:00Z", updatedAt: "2026-11-03T13:00:00Z",
});
const items = [item("CONFIRMED"), item("IN_EXECUTION"), item("DISPATCH_COMPLETED"), item("COMPLETED")];

function hooks() {
  let index = 0;
  const slots = [], effects = [], transitions = [];
  const memo = (fn, deps) => {
    const i = index++;
    if (!slots[i] || deps.some((d, n) => !Object.is(d, slots[i].deps[n]))) slots[i] = { deps, value: fn() };
    return slots[i].value;
  };
  return {
    reset() { index = 0; },
    async flush() { for (const effect of effects.splice(0)) effect(); await Promise.all(transitions.splice(0)); },
    react: {
      useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
      useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
      useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
      useEffect(fn, deps) { memo(() => { effects.push(fn); }, deps); },
      useTransition: () => [false, fn => transitions.push(fn())],
      useActionState: () => [{ status: "idle" }, () => {}, false],
    },
  };
}

test("solo Residente usa la presentación operativa; Admin y Compras tienen prioridad en roles combinados", () => {
  assert.equal(presentation.usesResidentProgrammingView(["RESIDENT"]), true);
  for (const role of ["PURCHASING", "COMPANY_ADMIN", "PLATFORM_ADMIN"]) {
    assert.equal(presentation.usesResidentProgrammingView([role]), false);
    assert.equal(presentation.usesResidentProgrammingView(["RESIDENT", role]), false);
  }
  assert.equal(presentation.usesResidentProgrammingView(["SUPERVISOR"]), false);
  assert.equal(presentation.usesResidentProgrammingView([]), false);
});

test("el kanban combina los estados financieros para Residente en escritorio y selector móvil sin mutar los registros", () => {
  for (const residentView of [true, false]) {
    const h = hooks();
    const { ProgrammingKanban } = load("features/programming/components/programming-kanban.tsx", {
      ...baseImports, react: h.react,
      "../kanban-actions": {}, "../kanban-policy": kanbanPolicy,
      "./programming-cancel-dialog": { ProgrammingCancelDialog: "CancelDialog" },
      "motion/react": { motion: { button: "button" }, useReducedMotion: () => true },
      "@/components/feedback/empty-state": { EmptyState: "EmptyState" }, "@/lib/motion/tokens": { motionTokens: {} },
    });
    let selected;
    const render = () => { h.reset(); return ProgrammingKanban({ items, timezone, residentView, onSelect: value => { selected = value; } }); };
    let tree = render();
    const sections = nodes(tree).filter(n => n.type === "section");
    assert.equal(sections.length, residentView ? 5 : 6);
    const column = sections.find(n => text(n).includes(residentView ? "Despacho completo" : "Pendiente de conciliación"));
    const cards = nodes(column).filter(n => typeof n.type === "function");
    assert.equal(cards.length, residentView ? 2 : 1);
    assert.ok(nodes(column).some(n => n.type === "span" && n.props.children === cards.length));
    const selector = nodes(tree).find(n => n.type === "select");
    assert.equal(nodes(selector).filter(n => n.type === "option").length, residentView ? 5 : 6);
    selector.props.onChange({ target: { value: "DISPATCH_COMPLETED" } });
    tree = render();
    const mobile = nodes(tree).find(n => n.props?.className === "lg:hidden");
    assert.equal(nodes(mobile).filter(n => typeof n.type === "function").length, residentView ? 2 : 1);
    for (const card of cards) {
      const renderedCard = card.type(card.props);
      assert.match(text(renderedCard), residentView ? /Despacho completo/u : /Pendiente de conciliación/u);
      const badge = nodes(renderedCard).find(n => n.props?.className?.includes("programming-status-tone"));
      assert.equal(badge.props.className.includes("programming-tone-resident-dispatch-completed"), residentView);
      nodes(renderedCard).find(n => n.type === "button").props.onClick();
      assert.equal(selected, card.props.item);
      assert.equal(selected.status, selected.id);
    }
    if (residentView) assert.doesNotMatch(text(tree), /Pendiente de conciliación|Completado/u);
  }
});

test("calendario y leyenda mantienen verde Despacho completo tras la conciliación sin alterar la vista completa", () => {
  for (const residentView of [true, false]) {
    let config;
    const h = hooks();
    const view = () => ({});
    const { ProgrammingCalendar } = load("features/programming/components/programming-calendar.tsx", {
      ...baseImports, react: h.react, "next-themes": { useTheme: () => ({ resolvedTheme: "dark" }) },
      "@schedule-x/calendar": { createViewDay: view, createViewMonthAgenda: view, createViewMonthGrid: view, createViewWeek: view, createViewWeekAgenda: view },
      "@schedule-x/react": { ScheduleXCalendar: "Calendar", useNextCalendarApp: value => { config = value; } },
      "temporal-polyfill/global": {},
    }, { Temporal: { Instant: { from: () => ({ toZonedDateTimeISO: () => ({}) }) }, Now: { zonedDateTimeISO: () => ({ toPlainDate: () => ({}) }) } } });
    let selected;
    ProgrammingCalendar({ items, timezone, residentView, onRangeChange() {}, onSelect: id => { selected = id; } });
    for (const event of config.events.slice(2)) {
      assert.equal(event.description, formatters.formatProgrammingStatus(event.id, residentView));
      assert.equal(event.calendarId, residentView || event.id === "DISPATCH_COMPLETED" ? "dispatchCompleted" : "completed");
      for (const content of Object.values(event._customContent)) {
        assert.ok(!content.includes(event.description));
        assert.ok(content.includes("07:00 · 6.5 M3 · Proveedor"));
      }
      config.callbacks.onEventClick(event);
      assert.equal(selected, event.id);
    }
    assert.equal(config.calendars.dispatchCompleted.lightColors.container, colors.programmingColorVariables("DISPATCH_COMPLETED", residentView).container);
    assert.equal(config.calendars.dispatchCompleted.darkColors.container, config.calendars.dispatchCompleted.lightColors.container);
    const { ProgrammingStatusLegend } = load("features/programming/components/programming-status-legend.tsx", baseImports);
    const legend = ProgrammingStatusLegend({ residentView });
    assert.equal(nodes(legend).filter(n => n.type === "li").length, residentView ? 5 : 6);
    if (residentView) assert.doesNotMatch(text(legend), /conciliaci|Completado|conciliados/u);
    else assert.match(text(legend), /Pendiente de conciliación.*Completado/u);
  }
});

function workspaceFixture(residentView) {
  const h = hooks(), requests = [];
  const imports = {
    ...baseImports, react: h.react, "../availability": availability,
    "../actions": { async loadProgrammingRange(projectId, range, filters) { requests.push({ projectId, range, filters }); return { status: "success", items: items.filter(i => !filters.status || i.effectiveStatus === filters.status) }; } },
    "@/components/feedback/error-state": { ErrorState: "ErrorState" },
    "@/components/feedback/use-delayed-pending": { useDelayedPending: () => false },
  };
  for (const [path, name] of [["@/components/motion/motion-page", "MotionPage"], ["@/components/motion/motion-section", "MotionSection"], ["@/components/motion/motion-swap", "MotionSwap"], ["./create-programming-dialog", "CreateProgrammingDialog"], ["./bulk-programming-dialog", "BulkProgrammingDialog"], ["./programming-calendar", "ProgrammingCalendar"], ["./programming-kanban", "ProgrammingKanban"], ["./programming-preview-drawer", "ProgrammingPreviewDrawer"], ["./programming-status-legend", "ProgrammingStatusLegend"]]) imports[path] = { [name]: name };
  const { ProgrammingWorkspace } = load("features/programming/components/programming-workspace.tsx", imports);
  let tree;
  const render = () => { h.reset(); tree = ProgrammingWorkspace({ residentView, project: { id: "project", timezone }, canCreate: false, canConfirm: false, canModify: false, canCancel: false, initialData: { items, suppliers: [], units: [], range: { start: "2026-11-01T06:00:00Z", end: "2026-12-01T06:00:00Z" } } }); };
  render();
  return { render, flush: h.flush, requests, all: () => nodes(tree), select: id => nodes(tree).find(n => n.props?.id === id), button: label => nodes(tree).find(n => n.type === "button" && text(n).trim() === label) };
}

test("el filtro Despacho completo y el Historial incluyen ambas etapas para Residente y conservan el proveedor", async () => {
  for (const residentView of [true, false]) {
    const f = workspaceFixture(residentView);
    await f.flush();
    f.select("programming-filter-supplier").props.onChange({ target: { value: "supplier" } });
    f.select("programming-filter-status").props.onChange({ target: { value: "DISPATCH_COMPLETED" } });
    f.render(); await f.flush(); f.render();
    const request = f.requests.at(-1);
    assert.equal(request.filters.supplierId, "supplier");
    assert.equal(request.filters.status, residentView ? undefined : "DISPATCH_COMPLETED");
    const calendar = f.all().find(n => n.type === "ProgrammingCalendar");
    assert.deepEqual(Array.from(calendar.props.items, i => i.status), residentView ? ["DISPATCH_COMPLETED", "COMPLETED"] : ["DISPATCH_COMPLETED"]);
    f.button("Historial").props.onClick(); f.render();
    const history = f.all().find(n => n.type === "ProgrammingCalendar");
    assert.equal(history.props.items.length, residentView ? 2 : 0);
    f.button("Limpiar").props.onClick(); f.render(); await f.flush(); f.render();
    assert.deepEqual(Array.from(f.all().find(n => n.type === "ProgrammingCalendar").props.items, i => i.status), residentView ? ["DISPATCH_COMPLETED", "COMPLETED"] : ["COMPLETED"]);
    f.button("Activas").props.onClick(); f.button("Kanban").props.onClick(); f.render();
    const kanban = f.all().find(n => n.type === "ProgrammingKanban");
    assert.equal(kanban.props.residentView, residentView);
    kanban.props.onSelect(items[3]); f.render();
    const preview = f.all().find(n => n.type === "ProgrammingPreviewDrawer");
    assert.equal(preview.props.item, items[3]);
    assert.equal(preview.props.item.status, "COMPLETED");
    assert.equal(preview.props.residentView, residentView);
    assert.equal(preview.props.canModify, false);
  }
});

test("las páginas obtienen la vista del rol autenticado sin modificar los permisos", async () => {
  for (const roleCodes of [["RESIDENT"], ["PURCHASING"], ["COMPANY_ADMIN", "RESIDENT"], ["PLATFORM_ADMIN"]]) {
    const permissions = ["programming.view", "dispatch.create"];
    const context = { roleCodes, permissions, activeProject: { id: "project", timezone } };
    const imports = {
      "react/jsx-runtime": runtime, "next/navigation": { notFound() { assert.fail("unexpected 404"); } },
      "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
      "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "user", fullName: "Usuario" }) },
      "@/features/projects/queries": { getProjectContext: async () => context },
      "@/features/projects/access-policy": access,
      "@/features/programming/queries": { getProgrammingPageData: async () => ({ items }), getProgrammingDetailPageData: async () => ({ detail: items[3] }) },
      "@/features/programming/status-presentation": presentation,
      "@/features/programming/components/programming-workspace": { ProgrammingWorkspace: "Workspace" },
      "@/features/programming/components/programming-detail-view": { ProgrammingDetailView: "Detail" },
    };
    const list = await load("app/(dashboard)/programming/page.tsx", imports).default();
    const detail = await load("app/(dashboard)/programming/[id]/page.tsx", imports).default({ params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    assert.equal(list.props.residentView, roleCodes.length === 1 && roleCodes[0] === "RESIDENT");
    assert.equal(detail.props.residentView, list.props.residentView);
    assert.equal(list.props.canModify, false);
    assert.equal(detail.props.permissions.canCreateDispatch, true);
    assert.equal(detail.props.permissions.canClose, false);
  }
});

test("detalle y vista previa conservan Despacho completo para Residente y ocultan eventos de conciliación solo en su presentación", () => {
  const dialogImports = {
    "../actions": {}, "../availability": availability,
    "@/components/feedback/loading-button": { LoadingButton: "LoadingButton" },
    "@/components/feedback/use-action-notification": { useActionNotification() {} },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/dialog": { Dialog: "Dialog", DialogFooter: "DialogFooter", useDialogAccessibility: () => ({ current: null }) },
    "@/lib/notification-messages": { notifications: {} }, "@/lib/status-labels": labels,
    "next/link": { default: "Link" }, "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "motion/react": { AnimatePresence: "AnimatePresence", motion: { button: "button", aside: "aside" } },
    "../invoice-policy": { deliveryModeLabel: () => "Bomba", requiresServiceInvoice: () => true },
    "./programming-edit-dialog": { ProgrammingEditDialog: "EditDialog" },
    "./programming-cancel-dialog": { ProgrammingCancelDialog: "CancelDialog" },
    "@/features/dispatches/components/register-dispatch-dialog": { StartDispatchDialog: "StartDispatchDialog" },
  };
  for (const residentView of [true, false]) {
    for (const status of ["DISPATCH_COMPLETED", "COMPLETED"]) {
      const h = hooks();
      const imports = { ...baseImports, ...dialogImports, react: h.react };
      const { ProgrammingDetailView } = load("features/programming/components/programming-detail-view.tsx", imports);
      const revisions = ["PROGRAMMING_DISPATCH_COMPLETED", "PROGRAMMING_COMPLETED", "PROGRAMMING_BILLING_REOPENED"].map((action, index) => ({
        id: action, action, status: index === 1 ? "COMPLETED" : "DISPATCH_COMPLETED", version: index + 1,
        actorName: "Compras", createdAt: items[3].createdAt, requestedQuantity: 6.5, unitCode: "M3", deliveryModes: ["PUMP"],
        changeReason: "Conciliación de Producto y Servicio pendiente.",
      }));
      const detail = Object.freeze({ ...item(status), revisions });
      const tree = ProgrammingDetailView({ data: { detail, suppliers: [], units: [] }, project: { id: "project", name: "Proyecto", timezone }, receiverName: "Residente", residentView, permissions: { canCreateDispatch: false, canModify: false, canConfirm: false, canCancel: false, canClose: false } });
      assert.ok(nodes(tree).some(n => n.type === "span" && text(n) === formatters.formatProgrammingStatus(status, residentView) && n.props.className?.includes(formatters.programmingStatusTone(status, residentView))));
      assert.equal(nodes(tree).filter(n => n.type === "li").length, residentView ? 1 : 3);
      assert.equal(nodes(tree).some(n => n.type === "button" && text(n).includes("Cerrar programación")), false);
      if (residentView) assert.doesNotMatch(text(tree), /Pendiente de conciliación|Programación completada|Conciliación de Producto|Producto y Servicio conciliados/u);
      else assert.match(text(tree), /Programación completada.*Programación pendiente de conciliación/u);
      assert.equal(detail.status, status);
      assert.equal(detail.revisions.length, 3);
      h.reset();
      const { ProgrammingPreviewDrawer } = load("features/programming/components/programming-preview-drawer.tsx", imports);
      const preview = ProgrammingPreviewDrawer({ item: detail, timezone, residentView, canConfirm: false, canModify: false, canCancel: false, suppliers: [], units: [], onUpdated() {}, onClose() {} });
      assert.ok(nodes(preview).some(n => n.type === "span" && text(n) === formatters.formatProgrammingStatus(status, residentView) && n.props.className?.includes(formatters.programmingStatusTone(status, residentView))));
    }
  }
});

test("el color del Residente es verde suave con contraste legible y los estados reales no habilitan otro despacho", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const channel = value => { const n = parseInt(value, 16) / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
  const luminance = hex => .2126 * channel(hex.slice(0, 2)) + .7152 * channel(hex.slice(2, 4)) + .0722 * channel(hex.slice(4, 6));
  const bg = css.match(/--programming-resident-dispatch-completed-bg: #([0-9a-f]{6})/u)[1];
  const fg = css.match(/--programming-resident-dispatch-completed-fg: #([0-9a-f]{6})/u)[1];
  assert.ok((Math.max(luminance(fg), luminance(bg)) + .05) / (Math.min(luminance(fg), luminance(bg)) + .05) >= 4.5);
  assert.ok(parseInt(bg.slice(2, 4), 16) > parseInt(bg.slice(0, 2), 16));
  for (const status of ["DISPATCH_COMPLETED", "COMPLETED"]) {
    assert.equal(availability.canCreateDispatchForProgramming({ ...item(status), operationStarted: true, hasPermission: true }), false);
    assert.equal(formatters.formatProgrammingStatus(status, true), "Despacho completo");
    assert.equal(formatters.programmingStatusTone(status, true), "programming-status-tone programming-tone-resident-dispatch-completed");
  }
});
