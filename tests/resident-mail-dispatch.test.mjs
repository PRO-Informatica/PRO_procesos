import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as security from "../src/features/auth/security.ts";
import * as gmailAccess from "../src/features/integrations/gmail/access-policy.ts";
import * as programmingTypes from "../src/features/programming/types.ts";
import * as projectAccess from "../src/features/projects/access-policy.ts";
import * as labels from "../src/lib/status-labels.ts";

function load(path, imports) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl, URL, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Missing import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const jsx = (type, props) => ({ type, props });
const runtime = { jsx, jsxs: jsx };
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const presentation = load("features/programming/status-presentation.ts", { "../projects/access-policy": projectAccess, "./types": programmingTypes });
const programmingFormatters = load("features/programming/formatters.ts", { "@/lib/status-labels": labels, "./status-presentation": presentation });
const dispatchFormatters = load("features/dispatches/formatters.ts", { "@/lib/status-labels": labels, "./catalog-estimates": { formatDispatchMoney: String } });
const baseImports = { "react/jsx-runtime": runtime, "lucide-react": {}, "next/link": { __esModule: true, default: "Link" } };

test("Correo y el indicador se ocultan para cuentas no corporativas aunque tengan permiso o sean administradores", () => {
  for (const email of ["usuario@gmail.com", "usuario@pro.com.gt", " USUARIO@PRO.COM.GT ", "usuario@pro.com.gt.example", ""]) {
    for (const isPlatformAdmin of [true, false]) {
      const context = { activeProject: { status: "ACTIVE" }, permissions: ["gmail.mailbox.view", "programming.view", "dispatch.view"] };
      const imports = {
        ...baseImports, "@/features/auth/security": security,
        "@/features/projects/access-policy": projectAccess,
        "@/features/integrations/gmail/access-policy": gmailAccess,
        "@/features/platform/platform-context": { usePlatformContext: () => ({ isPlatformAdmin, hasOperationalAccess: true }) },
        "@/features/projects/project-context": { useProjectContext: () => context },
        "@/features/projects/components/project-selector": { ProjectSelector: "ProjectSelector" },
        "@/components/shared/scope-switch-link": { ScopeSwitchLink: "ScopeSwitchLink" },
        "@/components/shared/theme-toggle": { ThemeToggle: "ThemeToggle" },
        "@/features/integrations/gmail/components/gmail-connection-indicator": { GmailConnectionIndicator: "GmailIndicator" },
        "next/navigation": { usePathname: () => "/programming" }, "next/image": { default: "Image" },
        "motion/react": { AnimatePresence: "AnimatePresence", motion: new Proxy({}, { get: (_, name) => name }) },
      };
      const profile = { email, fullName: "Usuario" };
      const sidebar = load("components/layout/app-sidebar.tsx", imports).AppSidebar({ profileEmail: email, collapsed: false, mobileOpen: false, onCollapse() {}, onMobileClose() {} });
      const topbar = load("components/layout/topbar.tsx", imports).Topbar({ profile, unreadNotifications: 0, onOpenNavigation() {} });
      const platformTopbar = load("features/platform/components/platform-topbar.tsx", imports).PlatformTopbar({ profile, onOpenNavigation() {} });
      const expected = security.hasExactCorporateDomain(email);
      assert.equal(nodes(sidebar).some(n => n.type === "Link" && n.props.href === "/mail"), expected);
      assert.equal(nodes(topbar).some(n => n.type === "GmailIndicator"), expected);
      assert.equal(nodes(platformTopbar).some(n => n.type === "GmailIndicator"), expected);
      assert.ok(nodes(sidebar).some(n => n.type === "Link" && n.props.href === "/programming"));
      assert.ok(nodes(sidebar).some(n => n.type === "Link" && n.props.href === "/dispatches"));
      context.permissions = ["programming.view"];
      if (!isPlatformAdmin) {
        const denied = load("components/layout/app-sidebar.tsx", imports).AppSidebar({ profileEmail: email, collapsed: false, mobileOpen: false, onCollapse() {}, onMobileClose() {} });
        assert.equal(nodes(denied).some(n => n.type === "Link" && n.props.href === "/mail"), false);
      }
    }
  }
});

test("abrir Correo directamente con sesión activa y sin acceso muestra el aviso sin cerrar sesión ni consultar correos", async () => {
  let connectionReads = 0, profileReads = 0;
  const imports = {
    ...baseImports, "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "@/features/auth/queries": { requireActiveProfile: async () => { profileReads++; return { id: "user", email: "usuario@gmail.com" }; } },
    "@/features/integrations/gmail/components/gmail-access-denied": { GmailAccessDenied: "Denied" },
    "@/features/integrations/gmail/components/gmail-mailbox-workspace": { GmailMailboxWorkspace: "Mailbox" },
    "@/features/integrations/gmail/components/gmail-onboarding-actions": {},
    "@/components/brand/google-logo": {},
    "@/features/integrations/gmail/access-policy": gmailAccess,
    "@/features/integrations/gmail/service": { getAuthorizedGmailRequestUser: async () => null, getGmailConnectionPublicStatus: async () => { connectionReads++; assert.fail("No debe consultar conexiones"); } },
    "@/features/integrations/gmail/server-environment": { getGmailServerEnvironment() { assert.fail("No debe consultar credenciales"); } },
    "@/features/platform/queries": { isPlatformAdmin: async () => false },
    "@/features/projects/queries": { getProjectContext: async () => ({ status: "ready", activeProject: { status: "ACTIVE" }, permissions: ["gmail.mailbox.view"] }) },
  };
  const mail = await load("app/(dashboard)/mail/page.tsx", imports).default();
  assert.equal(mail.type, "Denied");
  const onboarding = await load("app/integrations/gmail/page.tsx", imports).default({ searchParams: Promise.resolve({}) });
  assert.ok(nodes(onboarding).some(n => n.type === "Denied"));
  assert.equal(profileReads, 2);
  assert.equal(connectionReads, 0);
  imports["@/features/auth/queries"] = { requireActiveProfile: async () => { throw new Error("redirect:/login"); } };
  await assert.rejects(load("app/integrations/gmail/page.tsx", imports).default({ searchParams: Promise.resolve({}) }), /redirect:\/login/u);
});

test("las cuentas corporativas autorizadas conservan su bandeja y los permisos de envío", async () => {
  const imports = {
    ...baseImports, "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "user", email: "usuario@pro.com.gt" }) },
    "@/features/integrations/gmail/components/gmail-access-denied": { GmailAccessDenied: "Denied" },
    "@/features/integrations/gmail/components/gmail-mailbox-workspace": { GmailMailboxWorkspace: "Mailbox" },
    "@/features/integrations/gmail/access-policy": gmailAccess,
    "@/features/integrations/gmail/service": { getAuthorizedGmailRequestUser: async () => ({ id: "user" }), getGmailConnectionPublicStatus: async () => ({ connected: true, email: "usuario@pro.com.gt" }) },
    "@/features/integrations/gmail/server-environment": { getGmailServerEnvironment: () => ({ attachmentMaxBytes: 1024, recipientEmails: [] }) },
    "@/features/platform/queries": { isPlatformAdmin: async () => false },
    "@/features/projects/queries": { getProjectContext: async () => ({ status: "ready", activeProject: { id: "project", status: "ACTIVE" }, permissions: ["gmail.mailbox.view"] }) },
  };
  const tree = await load("app/(dashboard)/mail/page.tsx", imports).default();
  assert.equal(tree.type, "Mailbox");
  assert.equal(tree.props.connectedEmail, "usuario@pro.com.gt");
  assert.equal(tree.props.canSend, false);
});

test("Despacho completo conserva el mismo verde para Residente antes y después de conciliar; Compras conserva sus estados", () => {
  const { DispatchStatusBadge } = load("features/dispatches/components/dispatch-badges.tsx", {
    ...baseImports, "@/components/ui/badge": { Badge: "Badge", StatusBadge: "StatusBadge" },
    "@/features/programming/formatters": programmingFormatters, "../formatters": dispatchFormatters,
  });
  for (const billingComplete of [true, false]) {
    const resident = DispatchStatusBadge({ status: "COMPLETED", billingComplete, residentView: true });
    assert.equal(text(resident), "Despacho completo");
    assert.match(resident.props.className, /programming-tone-resident-dispatch-completed/u);
    const purchasing = DispatchStatusBadge({ status: "COMPLETED", billingComplete });
    assert.equal(purchasing.props.label, billingComplete ? "Completado" : "Pendiente de conciliación");
  }
  assert.equal(DispatchStatusBadge({ status: "IN_EXECUTION", residentView: true }).props.label, "En ejecución");
});

test("el filtro y las tarjetas de Despachos reúnen las dos etapas solo para Residente y mantienen los registros originales", () => {
  for (const residentView of [true, false]) {
    let index = 0;
    const state = [];
    const react = { useMemo: fn => fn(), useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } };
    const data = { units: [], items: ["DISPATCH_COMPLETED", "COMPLETED", "IN_EXECUTION"].map(programmingStatus => Object.freeze({
      programmingId: programmingStatus, programmingCode: `PRG-${programmingStatus}`, programmingStatus,
      dispatchId: programmingStatus, dispatchStatus: programmingStatus === "IN_EXECUTION" ? "IN_EXECUTION" : "COMPLETED",
      dispatchBillingComplete: programmingStatus === "COMPLETED", scheduledAt: "2026-11-03T13:00:00Z", concreteTypes: [], guides: [],
      productEstimate: {}, serviceEstimate: {}, supplierName: "Proveedor", unitCode: "M3",
    })) };
    const { DispatchesWorkspace } = load("features/dispatches/components/dispatches-workspace.tsx", {
      ...baseImports, react, "@/features/programming/formatters": programmingFormatters,
      "@/features/programming/status-presentation": presentation, "../formatters": dispatchFormatters,
      "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
      "@/components/motion/motion-page": { MotionPage: "MotionPage" }, "@/components/motion/motion-section": { MotionSection: "MotionSection" },
      "./dispatch-badges": { DispatchStatusBadge: "DispatchStatusBadge" }, "./dispatch-guide-dialog": { DispatchGuideDialog: "GuideDialog" }, "./register-dispatch-dialog": { StartDispatchDialog: "StartDialog" },
    });
    const render = () => { index = 0; return DispatchesWorkspace({ data, residentView, canCreate: true, canModify: false, receiverName: "Usuario", project: { id: "project", timezone: "America/Guatemala" } }); };
    let tree = render();
    const filter = nodes(tree).find(n => n.type === "select" && n.props["aria-label"] === "Estado programación");
    assert.equal(nodes(filter).some(n => n.type === "option" && n.props.value === "COMPLETED"), !residentView);
    filter.props.onChange({ target: { value: "DISPATCH_COMPLETED" } });
    tree = render();
    const rows = nodes(tree).filter(n => n.type === "tr" && typeof n.props.onClick === "function");
    assert.equal(rows.length, residentView ? 2 : 1);
    assert.equal(nodes(tree).filter(n => n.type === "article").length, rows.length);
    assert.equal(nodes(tree).filter(n => n.type === "DispatchStatusBadge").every(n => n.props.residentView === residentView), true);
    if (residentView) assert.doesNotMatch(text(tree), /Pendiente de conciliación|Completado/u);
    rows[0].props.onClick(); tree = render();
    assert.ok(text(tree).includes(residentView ? "Estado: Despacho completo" : "Estado: Completado"));
    assert.equal(data.items[0].programmingStatus, "DISPATCH_COMPLETED");
    assert.equal(data.items[1].programmingStatus, "COMPLETED");
  }
});

test("la consulta de Despachos conserva las programaciones después de completar la conciliación", async () => {
  const tables = {
    programming: ["DISPATCH_COMPLETED", "COMPLETED"].map(status => ({
      id: status, status, project_id: "project", supplier_id: "supplier", scheduled_at: "2026-11-03T13:00:00Z",
      unit_code: "M3", requested_quantity: 6.5, confirmed_quantity: null,
    })),
    dispatches: ["DISPATCH_COMPLETED", "COMPLETED"].map(programming_id => ({
      id: programming_id, programming_id, status: "COMPLETED", project_id: "project", version: 2,
    })),
    suppliers: [{ id: "supplier", name: "Proveedor" }], units_of_measure: [], dispatch_guides: [], programming_lines: [],
  };
  const snapshot = JSON.stringify(tables);
  const client = { from(table) {
    assert.ok(Object.hasOwn(tables, table), table);
    let data = tables[table];
    return {
      select() { return this; }, order() { return this; },
      eq(key, value) { data = data.filter(row => row[key] === value); return this; },
      in(key, values) { data = data.filter(row => values.includes(row[key])); return this; },
      then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
    };
  } };
  const { getDispatchPageData } = load("features/dispatches/queries.ts", {
    "server-only": {}, "@/lib/supabase/server": { createClient: async () => client }, "@/lib/supabase/admin": {},
    "./formatters": { ...dispatchFormatters, normalizeCatalogReference: value => value ?? "" },
    "@/features/invoices/service-reconciliation": {},
    "./billing-completion-queries": { getDispatchBillingCompletion: async () => ({ DISPATCH_COMPLETED: false, COMPLETED: true }) },
  });
  const data = await getDispatchPageData("project");
  assert.deepEqual(Array.from(data.items, item => item.programmingStatus), ["DISPATCH_COMPLETED", "COMPLETED"]);
  assert.deepEqual(Array.from(data.items, item => item.dispatchBillingComplete), [false, true]);
  assert.equal(JSON.stringify(tables), snapshot);
});

function paginationFixture(count) {
  let index = 0;
  const state = [];
  const data = { units: [], items: Array.from({ length: count }, (_, i) => ({
    programmingId: `id-${i + 1}`, programmingCode: `PRG-${String(i + 1).padStart(3, "0")}`,
    programmingStatus: ["IN_EXECUTION", "DISPATCH_COMPLETED", "COMPLETED"][i % 3],
    dispatchStatus: i % 3 === 0 ? "IN_EXECUTION" : "COMPLETED", dispatchId: `dispatch-${i + 1}`,
    dispatchBillingComplete: i % 3 === 2, scheduledAt: "2026-11-03T13:00:00Z",
    concreteTypes: [], guides: [], productEstimate: {}, serviceEstimate: {}, supplierName: "Proveedor", unitCode: "M3",
  })) };
  const { DispatchesWorkspace } = load("features/dispatches/components/dispatches-workspace.tsx", {
    ...baseImports,
    react: { useMemo: fn => fn(), useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } },
    "@/features/programming/formatters": programmingFormatters,
    "@/features/programming/status-presentation": presentation, "../formatters": dispatchFormatters,
    "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
    "@/components/motion/motion-page": { MotionPage: "MotionPage" }, "@/components/motion/motion-section": { MotionSection: "MotionSection" },
    "./dispatch-badges": { DispatchStatusBadge: "DispatchStatusBadge" }, "./dispatch-guide-dialog": { DispatchGuideDialog: "GuideDialog" }, "./register-dispatch-dialog": { StartDispatchDialog: "StartDialog" },
  });
  let tree;
  const render = () => { index = 0; tree = DispatchesWorkspace({ data, residentView: true, canCreate: false, canModify: false, receiverName: "Usuario", project: { id: "project", timezone: "America/Guatemala" } }); };
  render();
  return {
    render, data, all: () => nodes(tree),
    rows: () => nodes(tree).filter(n => n.type === "tr" && n.props.onClick),
    cards: () => nodes(tree).filter(n => n.type === "article"),
    nav: () => nodes(tree).find(n => n.type === "nav" && n.props["aria-label"] === "Paginación de despachos"),
    control: label => nodes(tree).find(n => n.props?.["aria-label"] === label),
    clickPage(label) { nodes(tree).find(n => n.props?.["aria-label"] === label).props.onClick(); render(); },
    filter(label, value) { nodes(tree).find(n => n.props?.["aria-label"] === label).props.onChange({ target: { value } }); render(); },
    clear() { nodes(tree).find(n => n.type === "button" && text(n).includes("Limpiar")).props.onClick(); render(); },
  };
}

test("Despachos pagina de diez en diez sin duplicar ni omitir registros en tabla y tarjetas", () => {
  const f = paginationFixture(25), snapshot = JSON.stringify(f.data);
  const seen = [];
  for (let page = 1; page <= 3; page++) {
    const rows = f.rows(), cards = f.cards();
    assert.equal(rows.length, page === 3 ? 5 : 10);
    assert.equal(cards.length, rows.length);
    const codes = rows.map(row => text(row.props.children[0]));
    cards.forEach((card, i) => assert.ok(text(card).includes(codes[i])));
    seen.push(...codes);
    assert.ok(text(f.nav()).includes(`Página ${page} de 3`));
    assert.equal(f.control("Ver página anterior").props.disabled, page === 1);
    assert.equal(f.control("Ver página siguiente").props.disabled, page === 3);
    if (page < 3) f.clickPage("Ver página siguiente");
  }
  assert.equal(new Set(seen).size, 25);
  assert.deepEqual(seen, f.data.items.map(item => item.programmingCode));
  assert.ok(text(f.nav()).includes("Mostrando 21–25 de 25 registros"));
  f.rows()[0].props.onClick(); f.render();
  assert.ok(f.all().some(n => n.type === "h2" && text(n) === "Despacho PRG-021"));
  f.clickPage("Ver página anterior");
  assert.equal(f.rows().length, 10);
  assert.equal(text(f.rows()[0].props.children[0]), "PRG-011");
  assert.equal(f.all().some(n => n.type === "h2" && text(n).startsWith("Despacho PRG-")), false);
  assert.equal(JSON.stringify(f.data), snapshot);
});

test("los filtros se aplican antes de paginar y vuelven a la primera página", () => {
  const f = paginationFixture(25);
  f.clickPage("Ver página siguiente"); f.clickPage("Ver página siguiente");
  f.filter("Estado programación", "DISPATCH_COMPLETED");
  assert.equal(f.rows().length, 10);
  assert.ok(text(f.nav()).includes("Página 1 de 2"));
  assert.ok(text(f.nav()).includes("de 16 registros"));
  f.clickPage("Ver página siguiente");
  assert.equal(f.rows().length, 6);
  f.filter("Código programación", "PRG-024");
  assert.equal(f.rows().length, 1);
  assert.equal(f.nav(), undefined);
  assert.equal(text(f.rows()[0].props.children[0]), "PRG-024");
  f.clear();
  assert.equal(f.rows().length, 10);
  assert.ok(text(f.nav()).includes("Página 1 de 3"));
  f.clickPage("Ver página siguiente");
  f.filter("Fecha", "2026-11-03");
  assert.ok(text(f.nav()).includes("Página 1 de 3"));
  f.filter("Código programación", "NO-EXISTE");
  assert.equal(f.rows().length, 0);
  assert.equal(f.cards().length, 0);
  assert.equal(f.nav(), undefined);
});

test("la paginación respeta los límites de diez registros y ajusta una página que deja de existir", () => {
  for (const count of [0, 10, 11]) {
    const f = paginationFixture(count);
    assert.equal(f.rows().length, Math.min(10, count));
    assert.equal(Boolean(f.nav()), count > 10);
    if (count === 11) {
      f.clickPage("Ver página siguiente");
      assert.equal(f.rows().length, 1);
      assert.ok(text(f.nav()).includes("Mostrando 11–11 de 11 registros"));
    }
  }
  const f = paginationFixture(25);
  f.clickPage("Ver página siguiente"); f.clickPage("Ver página siguiente");
  f.data.items = f.data.items.slice(0, 11); f.render();
  assert.ok(text(f.nav()).includes("Página 2 de 2"));
  assert.equal(f.rows().length, 1);
  assert.equal(f.control("Ver página siguiente").props.disabled, true);
});
