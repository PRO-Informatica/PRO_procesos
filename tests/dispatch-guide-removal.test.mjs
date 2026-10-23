import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const projectId = "78f495d6-d721-4b65-94f0-fdc94a03b8df";
const dispatchId = "38f495d6-d721-4b65-94f0-fdc94a03b8df";
const guideId = "28f495d6-d721-4b65-94f0-fdc94a03b8df";
const programmingId = "48f495d6-d721-4b65-94f0-fdc94a03b8df";
const actionsSource = await readFile(new URL("../src/features/dispatches/actions.ts", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("../src/features/dispatches/components/delete-dispatch-guide-dialog.tsx", import.meta.url), "utf8");
const detailSource = await readFile(new URL("../src/features/dispatches/components/dispatch-detail-view.tsx", import.meta.url), "utf8");

function load(source, imports) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require(path) {
    assert.ok(Object.hasOwn(imports, path), `Unexpected import: ${path}`);
    return imports[path];
  } });
  return exports;
}

function actionFixture({ authorized = true, queryError = null, rpcError = null } = {}) {
  const calls = [];
  const filters = {};
  const paths = [];
  const query = {
    select() { return query; },
    eq(key, value) { filters[key] = value; return query; },
    async maybeSingle() {
      const matches = filters.id === guideId && filters.project_id === projectId && filters.dispatch_id === dispatchId;
      return { data: matches ? { id: guideId } : null, error: queryError };
    },
  };
  const client = {
    from(table) { assert.equal(table, "dispatch_guides"); calls.push("query"); return query; },
    async rpc(name, args) {
      assert.equal(name, "delete_dispatch_guide");
      assert.equal(args.p_guide_id, guideId);
      assert.equal(args.p_expected_version, 2);
      calls.push("delete");
      return { data: 3, error: rpcError };
    },
  };
  const actions = load(actionsSource, {
    "next/cache": { revalidatePath: path => paths.push(path) },
    "@/features/auth/queries": { requireActiveProfile: async () => ({ id: projectId }) },
    "@/features/projects/queries": { getProjectContext: async () => ({
      status: "ready", activeProject: { id: projectId }, permissions: authorized ? ["dispatch.modify"] : [],
    }) },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": {}, "./validation": {}, "./registration": {},
  });
  return { remove: actions.deleteDispatchGuideAction, calls, filters, paths };
}

function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectId, dispatchId, guideId, programmingId, expectedVersion: "2", ...overrides })) data.set(key, value);
  return data;
}

test("elimina mediante el RPC existente solo dentro del proyecto y despacho indicados", async () => {
  const f = actionFixture();
  const result = await f.remove({}, form());
  assert.equal(result.status, "success");
  assert.equal(result.newVersion, 3);
  assert.deepEqual(f.calls, ["query", "delete"]);
  assert.equal(f.filters.project_id, projectId);
  assert.equal(f.filters.dispatch_id, dispatchId);
  assert.deepEqual(f.paths, ["/dispatches", `/dispatches/${dispatchId}`, `/programming/${programmingId}`]);
});

test("sin permiso o con datos inválidos no solicita eliminación", async () => {
  const denied = actionFixture({ authorized: false });
  assert.equal((await denied.remove({}, form())).status, "error");
  assert.equal(denied.calls.length, 0);
  for (const overrides of [{ guideId: "invalid" }, { dispatchId: "" }, { expectedVersion: "0" }]) {
    const f = actionFixture();
    assert.equal((await f.remove({}, form(overrides))).status, "error");
    assert.equal(f.calls.length, 0);
  }
});

test("una guía ajena al proyecto o despacho no llega al RPC", async () => {
  const foreignId = "58f495d6-d721-4b65-94f0-fdc94a03b8df";
  for (const overrides of [{ guideId: foreignId }, { dispatchId: foreignId }, { projectId: foreignId }]) {
    const f = actionFixture();
    assert.equal((await f.remove({}, form(overrides))).status, "error");
    assert.equal(f.calls.includes("delete"), false);
    assert.equal(f.paths.length, 0);
  }
});

test("un fallo de consulta no elimina ni invalida la vista", async () => {
  const f = actionFixture({ queryError: { message: "fetch failed" } });
  const result = await f.remove({}, form());
  assert.equal(result.status, "error");
  assert.match(result.message, /consultar la guía/u);
  assert.deepEqual(f.calls, ["query"]);
  assert.equal(f.paths.length, 0);
});

test("respeta evidencia, despacho completado, conflictos de versión y guía inexistente", async () => {
  for (const [message, expected] of [
    ["DISPATCH_GUIDE_HAS_EVIDENCE", /evidencia/u],
    ["DISPATCH_COMPLETED_NOT_EDITABLE", /completado/u],
    ["DISPATCH_VERSION_CONFLICT", /cambió/u],
    ["DISPATCH_GUIDE_NOT_FOUND", /ya no está disponible/u],
  ]) {
    const f = actionFixture({ rpcError: { message } });
    const result = await f.remove({}, form());
    assert.equal(result.status, "error");
    assert.match(result.message, expected);
    assert.equal(f.paths.length, 0);
  }
});

function dialogFixture({ state = { status: "idle" }, pending = false } = {}) {
  const events = [];
  const effects = [];
  const action = () => events.push("delete");
  const submit = () => events.push("submit");
  const jsx = (type, props) => ({ type, props });
  const components = load(dialogSource, {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useActionState(received) { assert.equal(received, action); return [state, submit, pending]; },
      useEffect(effect) { effects.push(effect); },
    },
    "lucide-react": { Trash2: "Trash2" },
    "next/navigation": { useRouter: () => ({ refresh: () => events.push("refresh") }) },
    "@/components/feedback/loading-button": { LoadingButton: "LoadingButton" },
    "@/components/feedback/use-action-notification": { useActionNotification() {} },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/dialog": { Dialog: "Dialog", DialogFooter: "DialogFooter" },
    "@/lib/notification-messages": { notifications: { guideRemoved: {}, actionFailed: {} } },
    "../actions": { deleteDispatchGuideAction: action },
    "../types": { initialDispatchMutationState: { status: "idle" } },
  });
  const tree = components.DeleteDispatchGuideDialog({ projectId, dispatchId, programmingId, expectedVersion: 2,
    guide: { id: guideId, guideNumber: "1234" }, onClose: () => events.push("close") });
  return { tree, events, effects, submit };
}

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

test("abrir y cancelar el modal no ejecuta el borrado; solo confirmar envía el formulario", () => {
  const f = dialogFixture();
  assert.match(f.tree.props.description, /1234/u);
  const formNode = nodes(f.tree).find(node => node.type === "form");
  assert.equal(formNode.props.action, f.submit);
  const hidden = Object.fromEntries(nodes(f.tree).filter(node => node.type === "input").map(node => [node.props.name, node.props.value]));
  assert.deepEqual(hidden, { projectId, programmingId, dispatchId, guideId, expectedVersion: 2 });
  f.effects.forEach(effect => effect());
  assert.deepEqual(f.events, []);
  nodes(f.tree).find(node => node.type === "Button").props.onClick();
  assert.deepEqual(f.events, ["close"]);
});

test("el modal bloquea cierre y botones mientras elimina", () => {
  const f = dialogFixture({ pending: true });
  assert.equal(f.tree.props.pending, true);
  for (const node of nodes(f.tree).filter(node => ["Button", "LoadingButton"].includes(node.type))) assert.equal(node.props.disabled, true);
});

test("el error conserva el modal; solo el éxito refresca los totales y cierra", () => {
  const failed = dialogFixture({ state: { status: "error", message: "Quita primero la evidencia" } });
  assert.equal(nodes(failed.tree).find(node => node.props?.role === "alert").props.children, "Quita primero la evidencia");
  failed.effects.forEach(effect => effect());
  assert.deepEqual(failed.events, []);
  const saved = dialogFixture({ state: { status: "success" } });
  saved.effects.forEach(effect => effect());
  assert.deepEqual(saved.events, ["refresh", "close"]);
});

test("ambas vistas abren confirmación, solo en despachos editables y fuera del formulario de guardado", () => {
  assert.equal(detailSource.match(/label=\{`Eliminar guía \$\{item.guideNumber\}`\}/gu)?.length, 2);
  assert.equal(detailSource.match(/onClick=\{\(\) => setGuideToDelete\(item\)\}/gu)?.length, 2);
  assert.match(detailSource, /guideToDelete && editable && <DeleteDispatchGuideDialog/u);
  assert.ok(detailSource.indexOf("</form>") < detailSource.indexOf("{guideToDelete &&"));
  assert.doesNotMatch(detailSource, /deleteDispatchGuideAction/u);
});
