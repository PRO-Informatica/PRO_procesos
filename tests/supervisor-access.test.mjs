import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as access from "../src/features/projects/access-policy.ts";
import * as gmailAccess from "../src/features/integrations/gmail/access-policy.ts";
import * as security from "../src/features/auth/security.ts";
import * as programmingTypes from "../src/features/programming/types.ts";

const inherited = ["programming.view", "programming.create", "programming.modify", "programming.confirm", "programming.cancel", "programming.close",
  "batch.view", "invoice.view", "report.view", "dispatch.view", "dispatch.create", "dispatch.modify", "dispatch.complete", "dispatch.register_incident", "document.upload", "document.view", "gmail.mailbox.view", "gmail.mail.send"];
const projectId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const context = { status: "ready", activeProject: { id: projectId, status: "ACTIVE", timezone: "America/Guatemala" },
  ...access.restrictSupervisorAccess({ roleCodes: ["SUPERVISOR"], permissions: inherited, isCompanyAdmin: false }) };
function load(path, imports) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl, File, Response, URL, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Missing import: ${name}`); return imports[name];
  } });
  return exports;
}
const jsx = (type, props) => ({ type, props });
const base = { "react/jsx-runtime": { jsx, jsxs: jsx }, "next/navigation": { notFound() { assert.fail("Unexpected 404"); } },
  "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "user", email: "supervisor@pro.com.gt", fullName: "Supervisor" }) },
  "@/features/projects/queries": { getProjectContext: async () => context },
  "@/features/projects/access-policy": access,
  "@/features/programming/status-presentation": { usesResidentProgrammingView: () => false },
  "@/components/feedback/empty-state": { EmptyState: "EmptyState" } };
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
}

test("Supervisor conserva lectura e inicio/carga de guías; otros roles siguen siendo aditivos", () => {
  for (const role of ["SUPERVISOR", "RECEPTION"]) {
    const input = { roleCodes: [role], permissions: [...inherited], isCompanyAdmin: false };
    const result = access.restrictSupervisorAccess(input);
    assert.deepEqual(result.permissions.sort(), ["programming.view", "dispatch.view", "document.view", "dispatch.create", "dispatch.manage_guides"].sort());
    assert.deepEqual(input.permissions, inherited);
    for (const extra of ["RESIDENT", "PURCHASING", "COMPANY_ADMIN", "PLATFORM_ADMIN"]) {
      const mixed = { ...input, roleCodes: [role, extra] };
      assert.equal(access.restrictSupervisorAccess(mixed), mixed);
    }
  }
  const viewer = access.restrictSupervisorAccess({ roleCodes: ["SUPERVISOR"], permissions: ["dispatch.view"], isCompanyAdmin: false });
  assert.deepEqual(viewer.permissions, ["dispatch.view"]);
});

test("Programación expone solo consulta; Despachos conserva inicio y carga de guías", async () => {
  const imports = { ...base,
    "@/features/programming/components/programming-workspace": { ProgrammingWorkspace: "ProgrammingWorkspace" },
    "@/features/programming/components/programming-detail-view": { ProgrammingDetailView: "ProgrammingDetailView" },
    "@/features/programming/queries": { getProgrammingPageData: async () => ({}), getProgrammingDetailPageData: async () => ({}) },
    "@/features/dispatches/components/dispatches-workspace": { DispatchesWorkspace: "DispatchesWorkspace" },
    "@/features/dispatches/components/dispatch-detail-view": { DispatchDetailView: "DispatchDetailView" },
    "@/features/dispatches/queries": { getDispatchPageData: async () => ({}), getDispatchDetail: async () => ({}) },
  };
  const programming = await load("app/(dashboard)/programming/page.tsx", imports).default();
  for (const key of ["canCreate", "canModify", "canConfirm", "canCancel"]) assert.equal(programming.props[key], false, key);
  const detail = await load("app/(dashboard)/programming/[id]/page.tsx", imports).default({ params: Promise.resolve({ id }) });
  assert.ok(Object.values(detail.props.permissions).every(value => value === false));
  const dispatches = await load("app/(dashboard)/dispatches/page.tsx", imports).default();
  assert.equal(dispatches.props.canCreate, true); assert.equal(dispatches.props.canModify, true);
  const dispatch = await load("app/(dashboard)/dispatches/[id]/page.tsx", imports).default({ params: Promise.resolve({ id }) });
  assert.equal(dispatch.props.permissions.canManageGuides, true);
  for (const key of ["canModify", "canComplete", "canRegisterIncident"]) assert.equal(dispatch.props.permissions[key], false, key);
});

test("las acciones de Programación rechazan formularios manipulados antes de acceder a datos", async () => {
  const actions = load("features/programming/actions.ts", { ...base, "next/cache": {},
    "@/features/dispatches/casting-elements": {}, "@/lib/supabase/server": { createClient() { assert.fail("No debe acceder a datos"); } },
    "./queries": {}, "./invoice-policy": { isDeliveryMode: value => value === "DIRECT" }, "./mixto-listo-workbook": {}, "./types": programmingTypes });
  const form = new FormData();
  for (const [key, value] of Object.entries({ projectId, programmingId: id, supplierId: id, expectedVersion: "1", scheduledAt: "2099-11-13T07:00",
    orderNumber: "QA-1", lineQuantity: "1", lineUnitCode: "M3", lineConcreteType: "CONF4001", deliveryModes: "DIRECT" })) form.set(key, value);
  for (const intent of ["edit", "confirm", "cancel", "close"]) {
    form.set("intent", intent);
    const result = await actions.mutateProgrammingAction({}, form);
    assert.equal(result.status, "error"); assert.match(result.message, /permiso/u);
  }
  const result = await actions.createProgrammingAction({}, form);
  assert.equal(result.status, "error"); assert.match(result.message, /permiso/u);
  form.set("rows", "[]"); form.set("workbook", new File(["QA"], "qa.xlsx"));
  const batch = await actions.createProgrammingBatchAction({}, form);
  assert.equal(batch.status, "error"); assert.match(batch.message, /permiso/u);
});

test("Supervisor corporativo solo ve Inicio, Programación y Despachos; sin campana ni Gmail", () => {
  const imports = { ...base, "lucide-react": {}, "next/link": { __esModule: true, default: "Link" },
    "next/image": { default: "Image" }, "next/navigation": { usePathname: () => "/dispatches" },
    "@/features/auth/security": security, "@/features/integrations/gmail/access-policy": gmailAccess,
    "@/features/platform/platform-context": { usePlatformContext: () => ({ isPlatformAdmin: false, hasOperationalAccess: true }) },
    "@/features/projects/project-context": { useProjectContext: () => context },
    "@/features/projects/components/project-selector": { ProjectSelector: "ProjectSelector" },
    "@/components/shared/scope-switch-link": { ScopeSwitchLink: "ScopeSwitchLink" }, "@/components/shared/theme-toggle": { ThemeToggle: "ThemeToggle" },
    "@/features/integrations/gmail/components/gmail-connection-indicator": { GmailConnectionIndicator: "GmailIndicator" },
    "motion/react": { AnimatePresence: "AnimatePresence", motion: new Proxy({}, { get: (_, name) => name }) } };
  const sidebar = load("components/layout/app-sidebar.tsx", imports).AppSidebar({ profileEmail: "supervisor@pro.com.gt", collapsed: false, mobileOpen: false, onCollapse() {}, onMobileClose() {} });
  const topbar = load("components/layout/topbar.tsx", imports).Topbar({ profile: { email: "supervisor@pro.com.gt", fullName: "Supervisor" }, unreadNotifications: 0, onOpenNavigation() {} });
  assert.deepEqual(nodes(sidebar).filter(n => n.type === "Link").map(n => n.props.href), ["/", "/programming", "/dispatches"]);
  assert.equal(nodes(topbar).some(n => n.type === "Link" && n.props.href === "/notifications"), false);
  assert.equal(nodes(topbar).some(n => n.type === "GmailIndicator"), false);
  for (const href of ["/programming", "/dispatches"]) assert.ok(nodes(sidebar).some(n => n.type === "Link" && n.props.href === href));
});

test("Gmail también rechaza el acceso directo de Supervisor sin cerrar su sesión", async () => {
  const serverAccess = load("features/integrations/gmail/server-access.ts", { "server-only": {},
    "@/features/platform/queries": { isPlatformAdmin: async () => false },
    "@/features/projects/queries": { getOperationalProjectAccess: async () => [{ project: context.activeProject, permissions: context.permissions }] },
    "./access-policy": gmailAccess });
  let permissionChecks = 0;
  const service = load("features/integrations/gmail/service.ts", { "server-only": {}, "node:crypto": {}, googleapis: {},
    "@/features/auth/application-access": { validateApplicationAccess: async () => ({ authorized: true }) },
    "@/features/auth/security": security, "@/lib/supabase/admin": {},
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user", email: "supervisor@pro.com.gt", email_confirmed_at: "2026-11-13" } } }) } }) },
    "./crypto-core": {}, "./policy": {}, "./server-environment": {}, "./types": {},
    "./server-access": { hasGmailModuleAccessForUser: async (...args) => { permissionChecks++; return serverAccess.hasGmailModuleAccessForUser(...args); } } });
  assert.equal(await service.getAuthorizedGmailRequestUser(), null); assert.equal(permissionChecks, 1);
});

test("secciones ocultas y subrutas se bloquean para Supervisor; los otros roles conservan sus accesos", () => {
  for (const section of ["/reports", "/batches", "/invoices", "/reconciliation", "/documents", "/notifications", "/mail"]) {
    for (const pathname of [section, `${section}/universal`, `${section}/${id}`]) {
      for (const role of ["SUPERVISOR", "RECEPTION"]) assert.equal(access.canAccessOperationalSection([role], pathname), false);
      for (const role of ["RESIDENT", "PURCHASING", "COMPANY_ADMIN", "PLATFORM_ADMIN"]) assert.equal(access.canAccessOperationalSection([role], pathname), true);
    }
  }
  for (const pathname of ["/", "/programming", `/programming/${id}`, "/dispatches", `/dispatches/${id}`]) {
    assert.equal(access.canAccessOperationalSection(["SUPERVISOR"], pathname), true);
  }
});

test("abrir las secciones por URL muestra Sin acceso sin consultar datos ni cerrar sesión", async () => {
  const deniedQuery = async () => { assert.fail("No debe consultar datos de la sección"); };
  const imports = { ...base,
    "@/features/batches/queries": { getBatchPageData: deniedQuery, getBatchDetail: deniedQuery },
    "@/features/batches/components/batches-workspace": {}, "@/features/batches/components/batch-detail-view": {},
    "@/features/invoices/queries": { getGlobalInvoices: deniedQuery }, "@/features/invoices/components/invoices-workspace": {},
    "@/features/reconciliation/queries": { getGlobalReconciliation: deniedQuery }, "@/features/reconciliation/components/reconciliation-workspace": {},
    "@/features/documents/queries": { getGlobalDocuments: deniedQuery }, "@/features/documents/components/documents-workspace": {},
    "@/features/notifications/queries": { getOperationalNotifications: deniedQuery }, "@/features/notifications/components/notifications-center": {},
    "@/features/reports/queries": { getGuideReport: deniedQuery }, "@/features/reports/filters": {}, "@/features/reports/components/guide-report": {},
  };
  for (const path of ["batches", "batches/[id]", "invoices", "reconciliation", "documents", "notifications", "reports"]) {
    const tree = await load(`app/(dashboard)/${path}/page.tsx`, imports).default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    assert.ok(nodes(tree).some(n => n.type === "EmptyState" && n.props.title.startsWith("Sin acceso")), path);
  }
});

test("radar y acciones documentales/notificaciones bloquean accesos directos sin afectar archivos de guías", async () => {
  const imports = { ...base, "server-only": {}, "next/cache": {},
    "@/lib/supabase/server": { createClient: async () => { assert.fail("No debe acceder a datos"); } }, "@/lib/supabase/admin": {},
    "./queries": { getUniversalReportScopes: async () => [] },
  };
  const scopes = load("features/reports/report-scope.ts", imports);
  assert.deepEqual([...(await scopes.getRadarProjectScope("user", false))], []);
  const docs = load("features/documents/actions.ts", { ...imports,
    "@/features/projects/queries": { getProjectContext: async () => ({ ...context, projects: [context.activeProject] }) } });
  assert.equal((await docs.getGlobalDocumentUrl(projectId, id)).status, "error");
  const notifications = load("features/notifications/actions.ts", imports);
  const form = new FormData(); form.set("projectId", projectId); form.set("key", "QA");
  await notifications.markNotificationRead(form); await notifications.markAllNotificationsRead(form);
  assert.ok(context.permissions.includes("document.view"));
  assert.ok(context.permissions.includes("dispatch.manage_guides"));
});

test("el layout no carga notificaciones de Supervisor y conserva la sesión y navegación", async () => {
  const layout = load("app/(dashboard)/layout.tsx", { ...base,
    "next/navigation": { redirect() { assert.fail("No debe salir de la aplicación"); } },
    "@/components/layout/app-shell": { AppShell: "AppShell" },
    "@/features/platform/platform-context": { PlatformProvider: "PlatformProvider" },
    "@/features/platform/queries": { isPlatformAdmin: async () => false },
    "@/features/projects/project-context": { ProjectProvider: "ProjectProvider" },
    "@/features/notifications/queries": { getUnreadNotificationCount: async () => { assert.fail("No debe cargar notificaciones"); } },
  });
  const tree = await layout.default({ children: "Contenido operacional" });
  assert.equal(nodes(tree).find(n => n.type === "AppShell").props.unreadNotifications, 0);
});

test("Inicio no muestra lotes, conciliación ni accesos financieros a Supervisor", () => {
  const imports = { ...base, "lucide-react": {}, "next/link": { __esModule: true, default: "Link" },
    "@/components/motion/motion-page": { MotionPage: "MotionPage" },
    "@/components/motion/motion-list": { MotionList: "MotionList", MotionItem: "MotionItem" },
    "@/components/motion/motion-section": { MotionSection: "MotionSection" },
    "@/components/feedback/animated-progress": { AnimatedProgress: "AnimatedProgress" },
    "@/lib/status-labels": { formatStatusLabel: String }, "../formatters": { formatDateRange: () => "Semana", formatQuantity: String },
    "./dashboard-charts": { BatchReconciliationChart: "BatchChart", WeeklyVolumeChart: "WeeklyChart" },
    "./recent-activity": { RecentActivity: "RecentActivity" },
  };
  const data = { metrics: { today: {}, week: {}, month: {}, orders: {}, attention: { reinvoicing: 1, overdueProgramming: 1, pendingInvoice: 1 } },
    currentBatch: { id: "batch" }, activity: ["programming", "dispatch", "dispatch_guide", "invoice", "reconciliation_order"].map(entityType => ({ entityType })) };
  const component = load("features/dashboard/components/project-dashboard.tsx", imports).ProjectDashboard;
  const tree = component({ project: context.activeProject, roleCodes: ["SUPERVISOR"], data });
  assert.equal(nodes(tree).some(n => n.type === "BatchChart"), false);
  assert.equal(nodes(tree).some(n => n.type === "Link" && /^\/(batches|invoices|reconciliation|reports)/u.test(n.props.href)), false);
  assert.deepEqual(nodes(tree).find(n => n.type === "RecentActivity").props.items.map(n => n.entityType), ["programming", "dispatch", "dispatch_guide"]);
  const admin = component({ project: context.activeProject, roleCodes: ["COMPANY_ADMIN"], data });
  assert.ok(nodes(admin).some(n => n.type === "BatchChart"));
});

test("exportar Reportería por URL devuelve 403 antes de consultar datos o archivos", async () => {
  const imports = { ...base, exceljs: {},
    "@/features/reports/queries": { getGuideReport: async () => { assert.fail("No debe generar reportes"); } },
    "@/features/reports/export-utils": {}, "@/features/reports/archive-queries": {}, "@/features/reports/zip-archive": {},
    "@/features/reports/zip-response": {}, "@/features/reports/filters": {}, "@/features/reports/presentation": {},
    "@/features/reports/workbook-header": {}, "@/lib/status-labels": {}, "@/lib/supabase/admin": {}, "@/lib/supabase/server": {},
  };
  const response = await load("app/(dashboard)/reports/export/route.ts", imports).GET({ nextUrl: new URL("http://localhost:3000/reports/export") });
  assert.equal(response.status, 403);
});
