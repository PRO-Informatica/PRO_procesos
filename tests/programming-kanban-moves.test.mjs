import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "../src/features/programming/kanban-policy.ts";
import * as availability from "../src/features/programming/availability.ts";
import * as access from "../src/features/projects/access-policy.ts";
import * as types from "../src/features/programming/types.ts";

function load(path, imports, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl, FormData, ...globals, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Missing import: ${name}`); return imports[name];
  } });
  return exports;
}
const presentation = load("features/programming/status-presentation.ts", { "../projects/access-policy": access, "./types": types });
const id = "00000000-0000-4000-8000-000000000001", projectId = "00000000-0000-4000-8000-000000000002";
const item = (status = "CONFIRMED", patch = {}) => ({ id, projectId, version: 2, status, effectiveStatus: status,
  scheduledAt: "2099-11-14T13:00:00Z", dispatches: [], supplierName: "Proveedor", requestedQuantity: 12, unitCode: "M3", ...patch });
const permissions = { canStart: true, canCancel: true };
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

test("solo Confirmado sin despacho admite En ejecución y Cancelado; ningún otro origen o destino se habilita", () => {
  assert.deepEqual(policy.getKanbanMoveTargets(item(), permissions), ["IN_EXECUTION", "CANCELLED"]);
  for (const status of types.PROGRAMMING_EFFECTIVE_STATUSES.filter(status => status !== "CONFIRMED")) {
    assert.deepEqual(policy.getKanbanMoveTargets(item(status), permissions), [], status);
  }
  assert.deepEqual(policy.getKanbanMoveTargets(item("CONFIRMED", { effectiveStatus: "EXPIRED" }), permissions), []);
  assert.deepEqual(policy.getKanbanMoveTargets(item("CONFIRMED", { dispatches: [{ id: "dispatch" }] }), permissions), []);
  assert.deepEqual(policy.getKanbanMoveTargets(item(), { canStart: true, canCancel: false }), ["IN_EXECUTION"]);
  assert.deepEqual(policy.getKanbanMoveTargets(item(), { canStart: false, canCancel: true }), ["CANCELLED"]);
  assert.deepEqual(policy.getKanbanMoveTargets(item(), { canStart: false, canCancel: false }), []);
});

function server({ roles = ["RESIDENT"], grants = ["programming.view", "dispatch.create", "programming.cancel"],
  row = { status: "CONFIRMED", version: 2, scheduled_at: "2099-11-14T13:00:00Z" }, dispatches = [], contextProject = projectId,
  queryError = null, result = { status: "success" } } = {}) {
  const calls = [], reads = [];
  const db = { from(table) {
    const filters = {}; reads.push({ table, filters });
    const response = () => ({ data: table === "programming" ? row : dispatches, error: queryError });
    const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; }, limit() { return q; },
      maybeSingle: async () => response(), then(resolve) { return Promise.resolve(response()).then(resolve); } };
    return q;
  } };
  const actions = load("features/programming/kanban-actions.ts", {
    "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "actor" }) },
    "@/features/projects/queries": { getProjectContext: async () => ({ status: "ready", roleCodes: roles, permissions: grants, activeProject: { id: contextProject, timezone: "America/Guatemala" } }) },
    "@/lib/supabase/server": { createClient: async () => db }, "./availability": availability, "./kanban-policy": policy, "./status-presentation": presentation,
    "@/features/dispatches/actions": { startDispatchAction: async (_, form) => { calls.push({ action: "start", form }); return result; } },
    "./actions": { mutateProgrammingAction: async (_, form) => { calls.push({ action: "cancel", form }); return result; } },
  });
  function form(intent = "start", patch = {}) {
    const f = new FormData();
    for (const [key, value] of Object.entries({ projectId, programmingId: id, expectedVersion: "2", intent, reason: "Cambio solicitado", ...patch })) f.set(key, value);
    return f;
  }
  return { action: actions.moveProgrammingKanbanAction, calls, reads, form };
}

test("el servidor inicia mediante el flujo real y conserva la cancelación con motivo y versión", async () => {
  for (const intent of ["start", "cancel"]) {
    const f = server(); const form = f.form(intent);
    assert.equal((await f.action({}, form)).status, "success");
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, intent); assert.equal(f.calls[0].form, form);
    for (const read of f.reads) assert.equal(read.filters.project_id, projectId);
  }
});

test("Supervisor, Compras y administradores no pueden invocar los movimientos del Residente", async () => {
  for (const roles of [["SUPERVISOR"], ["PURCHASING"], ["COMPANY_ADMIN"], ["PLATFORM_ADMIN"], ["RESIDENT", "PURCHASING"], []]) {
    for (const intent of ["start", "cancel"]) {
      const f = server({ roles });
      assert.equal((await f.action({}, f.form(intent))).status, "error");
      assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
    }
  }
});

test("el servidor bloquea En ejecución, estados finales, vencidos, versiones antiguas y despachos existentes", async () => {
  for (const settings of [
    ...types.PROGRAMMING_STATUSES.filter(status => status !== "CONFIRMED").map(status => ({ row: { status, version: 2, scheduled_at: "2099-11-14T13:00:00Z" } })),
    { row: { status: "CONFIRMED", version: 3, scheduled_at: "2099-11-14T13:00:00Z" } },
    { row: { status: "CONFIRMED", version: 2, scheduled_at: "2000-01-01T13:00:00Z" } },
    { dispatches: [{ id: "existing" }] }, { row: null }, { queryError: { message: "No disponible" } },
  ]) {
    for (const intent of ["start", "cancel"]) {
      const f = server(settings); assert.equal((await f.action({}, f.form(intent))).status, "error"); assert.equal(f.calls.length, 0);
    }
  }
});

test("formularios manipulados, otro proyecto y permisos faltantes no producen escrituras", async () => {
  for (const intent of ["CONFIRMED", "DISPATCH_COMPLETED", "COMPLETED", "CANCELLED", "EXPIRED", "edit", "close", "confirm", ""]) {
    const f = server(); assert.equal((await f.action({}, f.form(intent))).status, "error"); assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
  }
  for (const settings of [{ contextProject: id }, { grants: ["programming.view"] }, { grants: ["dispatch.create", "programming.cancel"] }]) {
    const f = server(settings); assert.equal((await f.action({}, f.form())).status, "error"); assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
  }
  const failure = server({ result: { status: "error", message: "Otra sesión inició el despacho." } });
  assert.equal((await failure.action({}, failure.form())).status, "error");
});

function board({ residentView = true, canStart = true, canCancel = true, actionResult = { status: "success" } } = {}) {
  let hook = 0, updated = 0, selected = 0;
  const slots = [], tasks = [], calls = [];
  const jsx = (type, props) => ({ type, props });
  const react = { useState(initial) { const index = hook++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useRef(initial) { const index = hook++; return slots[index] ??= { current: initial }; },
    useTransition: () => [false, callback => tasks.push(callback())] };
  const { ProgrammingKanban } = load("features/programming/components/programming-kanban.tsx", {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": {}, "motion/react": { motion: { button: "button" }, useReducedMotion: () => true },
    "@/components/feedback/empty-state": { EmptyState: "EmptyState" }, "@/lib/motion/tokens": { motionTokens: {} }, "../types": types,
    "../formatters": { formatProgrammingDate: String, formatProgrammingTime: String, formatProgrammingQuantity: String, formatProgrammingStatus: String, programmingStatusTone: () => "tone" },
    "../status-presentation": presentation, "../kanban-policy": policy,
    "./programming-cancel-dialog": { ProgrammingCancelDialog: "CancelDialog" },
    "../kanban-actions": { moveProgrammingKanbanAction: async (_, form) => { calls.push(Object.fromEntries(form)); return actionResult; } },
  });
  const items = [item(), ...["IN_EXECUTION", "DISPATCH_COMPLETED", "COMPLETED", "CANCELLED", "EXPIRED"].map(status => item(status, { id: status }))];
  const render = () => { hook = 0; return ProgrammingKanban({ items, timezone: "America/Guatemala", residentView, canStart, canCancel, onUpdated: () => { updated++; }, onSelect: () => { selected++; } }); };
  const cards = tree => nodes(tree).filter(n => typeof n.type === "function").map(n => n.type(n.props));
  const transfer = new Map();
  const event = () => ({ preventDefault() { this.prevented = true; }, dataTransfer: { setData: (type, value) => transfer.set(type, value), getData: type => transfer.get(type) ?? "" } });
  return { render, cards, event, calls, get updated() { return updated; }, get selected() { return selected; }, flush: async () => { await Promise.all(tasks.splice(0)); } };
}

test("arrastrar Confirmado solo habilita las dos columnas y persiste antes de refrescar", async () => {
  const f = board(); let tree = f.render();
  const card = f.cards(tree)[0]; assert.equal(card.props.draggable, true);
  assert.equal(nodes(card).find(n => n.type === "button").props.draggable, true);
  const drag = f.event(); card.props.onDragStart(drag); assert.equal(drag.dataTransfer.effectAllowed, "move"); tree = f.render();
  for (const section of nodes(tree).filter(n => n.type === "section")) {
    const event = f.event(); section.props.onDragOver(event);
    assert.equal(Boolean(event.prevented), ["IN_EXECUTION", "CANCELLED"].includes(section.props["aria-label"]));
    if (!["IN_EXECUTION", "CANCELLED"].includes(section.props["aria-label"])) section.props.onDrop(f.event());
  }
  assert.equal(f.calls.length, 0);
  nodes(tree).find(n => n.type === "section" && n.props["aria-label"] === "IN_EXECUTION").props.onDrop(f.event());
  const moved = nodes(f.render()).find(n => n.type === "section" && n.props["aria-label"] === "IN_EXECUTION");
  assert.equal(f.cards(moved).length, 2);
  await f.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].intent, "start"); assert.equal(f.updated, 1);
});

test("Cancelado abre el motivo sin escribir; volver conserva el tablero y móvil/teclado ofrece las mismas opciones", () => {
  const f = board(); let tree = f.render(); const card = f.cards(tree)[0];
  const select = nodes(card).find(n => n.type === "select");
  assert.deepEqual(nodes(select).filter(n => n.type === "option").map(n => n.props.value), ["", "IN_EXECUTION", "CANCELLED"]);
  select.props.onChange({ target: { value: "CANCELLED" } }); tree = f.render();
  const dialog = nodes(tree).find(n => n.type === "CancelDialog"); assert.ok(dialog); assert.equal(typeof dialog.props.mutationAction, "function");
  assert.equal(f.cards(nodes(tree).find(n => n.type === "section" && n.props["aria-label"] === "CANCELLED")).length, 2);
  assert.equal(f.calls.length, 0); assert.equal(f.updated, 0); dialog.props.onClose();
  assert.equal(nodes(f.render()).some(n => n.type === "CancelDialog"), false);
  assert.equal(f.cards(nodes(f.render()).find(n => n.type === "section" && n.props["aria-label"] === "CANCELLED")).length, 1);
});

test("ninguna tarjeta En ejecución o finalizada es movible; otros roles y vistas sin permiso conservan consulta", () => {
  for (const options of [{}, { residentView: false }, { canStart: false, canCancel: false }]) {
    const f = board(options); const tree = f.render();
    for (const card of f.cards(tree)) {
      const movable = options.residentView !== false && !(options.canStart === false && options.canCancel === false) && nodes(card).some(n => n.type === "select");
      assert.equal(card.props.draggable, Boolean(movable));
    }
    const sections = nodes(tree).filter(n => n.type === "section" && n.props["aria-label"] !== "CONFIRMED");
    for (const section of sections) for (const card of f.cards(section)) {
      assert.equal(card.props.draggable, false); assert.equal(nodes(card).some(n => n.type === "select"), false);
    }
  }
});

test("un fallo de guardado informa el error y no mueve ni refresca la tarjeta como si hubiese guardado", async () => {
  const f = board({ actionResult: { status: "error", message: "No fue posible iniciar" } });
  nodes(f.cards(f.render())[0]).find(n => n.type === "select").props.onChange({ target: { value: "IN_EXECUTION" } }); await f.flush();
  assert.equal(f.updated, 0); assert.ok(nodes(f.render()).some(n => n.props?.role === "alert" && n.props.children === "No fue posible iniciar"));
  assert.equal(f.cards(nodes(f.render()).find(n => n.type === "section" && n.props["aria-label"] === "IN_EXECUTION")).length, 1);
});
