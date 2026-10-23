import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { guideTotalInput, initialRealVolumeOverride } from "../src/features/dispatches/real-volume.ts";
import { realVolumeWarning } from "../src/features/dispatches/validation.ts";

const source = await readFile(new URL("../src/features/dispatches/components/dispatch-detail-view.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function guide(quantity, index = 0) {
  return { id: `guide-${index}`, guideNumber: String(index), guideDate: "2026-10-23", quantity, unitCode: "M3", productCount: 1, serviceCount: 0, lines: [] };
}

// Render the actual component with persistent hook state, as on router.refresh().
// Only UI/navigation boundaries are stubbed; volume logic and handlers are real.
function fixture(overrides = {}, permissions = { canModify: true }) {
  let detail = {
    id: "dispatch", programmingId: "programming", programmingCode: "PRG-TEST", version: 1,
    programmingScheduledAt: "2026-10-23T19:00:00Z", status: "IN_EXECUTION", result: "DISPATCHED",
    arrivalAt: null, departureAt: null, receivedByName: "Residente", orderNumber: "47",
    realVolume: null, realUnitCode: null, programmedVolume: 15.5, programmedUnitCode: "M3",
    programmingConcreteTypes: [], units: [{ code: "M3" }, { code: "KM" }], guides: [guide(15.5)],
    documents: [], incidents: [], batches: [], reconciliation: null,
    productEstimate: { amount: 0, complete: true, lineCount: 1 }, serviceEstimate: { amount: 0, complete: true, lineCount: 0 },
    ...overrides,
  };
  let hookIndex = 0;
  const state = [];
  const jsx = (type, props) => ({ type, props });
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState(initial) {
        const index = hookIndex++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
      },
      useMemo: callback => callback(), useEffect() {},
      useActionState: () => [{ status: "idle" }, () => {}, false], useTransition: () => [false, () => {}],
    },
    "lucide-react": {}, "next/link": { default: "Link" },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/components/feedback/use-action-notification": { useActionNotification() {} },
    "@/features/batches/actions": {}, "@/lib/notification-messages": { notifications: {} },
    "@/lib/notify": {}, "@/lib/status-labels": { formatStatusLabel: value => value },
    "../actions": {}, "../types": { initialDispatchMutationState: { status: "idle" } },
    "../validation": { realVolumeWarning }, "../real-volume": { guideTotalInput, initialRealVolumeOverride },
    "../formatters": Object.fromEntries(["formatDispatchDate", "formatDispatchDateTime", "formatDispatchMoney", "formatDispatchQuantity"].map(name => [name, String])),
  };
  for (const [path, names] of [
    ["@/components/documents/document-preview-dialog", ["DocumentActions"]],
    ["@/components/feedback/empty-state", ["EmptyState"]],
    ["@/components/feedback/loading-button", ["LoadingButton"]],
    ["@/components/motion/motion-page", ["MotionPage"]],
    ["@/components/motion/motion-section", ["MotionSection"]],
    ["@/components/ui/badge", ["Badge", "StatusBadge"]],
    ["@/components/ui/button", ["Button"]], ["@/components/ui/dialog", ["Dialog", "DialogFooter"]],
    ["@/components/ui/icon-button", ["IconButton"]],
    ["./dispatch-badges", ["DispatchResultBadge", "DispatchStatusBadge"]],
    ["./dispatch-guide-dialog", ["DispatchGuideDialog"]],
    ["./delete-dispatch-guide-dialog", ["DeleteDispatchGuideDialog"]],
    ["./document-uploader", ["DocumentUploader"]], ["./register-incident-dialog", ["RegisterIncidentDialog"]],
  ]) imports[path] = Object.fromEntries(names.map(name => [name, name]));
  const exports = {};
  runInNewContext(compiled, { exports, require(path) { assert.ok(Object.hasOwn(imports, path), path); return imports[path]; }, Intl, Date });
  let tree;
  function render(patch = {}) {
    detail = { ...detail, ...patch };
    hookIndex = 0;
    tree = exports.DispatchDetailView({ detail, project: { id: "project", timezone: "America/Guatemala" }, permissions });
  }
  function all(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(all);
    return [node, ...all(node.props?.children)];
  }
  const find = predicate => all(tree).find(predicate);
  const input = () => find(node => node.props?.id === "dispatch-real-volume");
  render();
  return {
    render, input, find,
    edit(value) { input().props.onChange({ target: { value } }); render(); },
    guides(quantities) { render({ guides: quantities.map(guide) }); },
    result(value) { find(node => node.props?.id === "dispatch-result").props.onChange({ target: { value } }); render(); },
    unit(value) { find(node => node.props?.name === "realUnitCode" && node.type === "select").props.onChange({ target: { value } }); render(); },
    reset() { find(node => node.type === "button" && node.props.children === "Usar total de guías").props.onClick(); render(); },
  };
}

test("precarga el total actual y mantiene el campo editable", () => {
  const f = fixture();
  assert.equal(f.input().props.value, "15.5");
  assert.equal(f.input().props.disabled, false);
  assert.equal(f.input().props.readOnly, undefined);
  assert.equal(f.input().props.step, "0.001");
});

test("sigue el total al crear, editar y eliminar guías sin remontar el formulario", () => {
  const f = fixture({ guides: [] });
  assert.equal(f.input().props.value, "0");
  for (const [quantities, expected] of [[[10, 5.5], "15.5"], [[10, 6], "16"], [[6], "6"], [[], "0"]]) {
    f.guides(quantities);
    assert.equal(f.input().props.value, expected);
  }
});

test("una corrección manual se conserva aunque cambien guías o se refresquen los datos", () => {
  const f = fixture();
  f.edit("14.75");
  f.guides([20]);
  assert.equal(f.input().props.value, "14.75");
  f.render({ realVolume: 15.5, version: 2 });
  assert.equal(f.input().props.value, "14.75");
  f.edit(""); f.guides([21]);
  assert.equal(f.input().props.value, "");
  f.edit("0"); f.guides([22]);
  assert.equal(f.input().props.value, "0");
});

test("conserva diferencias ya guardadas, pero un valor alineado puede seguir las guías", () => {
  const manual = fixture({ realVolume: 14, realUnitCode: "M3" });
  manual.guides([20]);
  assert.equal(manual.input().props.value, "14");
  const automatic = fixture({ realVolume: 15.5, realUnitCode: "M3" });
  automatic.guides([20]);
  assert.equal(automatic.input().props.value, "20");
});

test("usar total de guías reactiva el cálculo con la misma UM y evita conversiones implícitas", () => {
  const f = fixture();
  f.unit("KM"); f.guides([20]);
  assert.equal(f.input().props.value, "15.5");
  f.reset();
  assert.equal(f.input().props.value, "20");
  assert.equal(f.find(node => node.type === "select" && node.props.name === "realUnitCode").props.value, "M3");
  f.guides([21]);
  assert.equal(f.input().props.value, "21");
  const otherUnit = fixture({ realVolume: 12, realUnitCode: "KM" });
  otherUnit.guides([30]);
  assert.equal(otherUnit.input().props.value, "12");
});

test("no despachado mantiene cero sin perder la corrección anterior al volver a despachado", () => {
  const f = fixture();
  f.edit("14.5"); f.result("NOT_DISPATCHED"); f.guides([20]);
  assert.equal(f.input().props.value, "0");
  assert.equal(f.input().props.disabled, true);
  f.result("DISPATCHED");
  assert.equal(f.input().props.value, "14.5");
});

test("despachos finalizados o sin permiso conservan su volumen guardado y no son editables", () => {
  for (const f of [fixture({ status: "COMPLETED", realVolume: 14 }), fixture({ realVolume: 14 }, { canModify: false })]) {
    f.guides([20]);
    assert.equal(f.input().props.value, "14");
    assert.equal(f.input().props.disabled, true);
    assert.equal(f.find(node => node.type === "button" && node.props.children === "Usar total de guías"), undefined);
  }
});

test("normaliza la precisión a tres decimales sin introducir formato monetario ni ruido binario", () => {
  const f = fixture({ guides: [guide(0.1, 0), guide(0.2, 1)] });
  assert.equal(f.input().props.value, "0.3");
  assert.equal(guideTotalInput(1234.567), "1234.567");
  assert.equal(initialRealVolumeOverride({ editable: false, realVolume: null, realUnitCode: null, programmedUnitCode: "M3", guideTotal: 20 }), "");
});
