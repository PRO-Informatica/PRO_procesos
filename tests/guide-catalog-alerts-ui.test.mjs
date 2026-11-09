import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as model from "../src/features/vision-ocr/guide-draft.ts";
import * as casting from "../src/features/dispatches/casting-elements.ts";
import { catalogSelectionDefaults } from "../src/features/dispatches/catalog-selection.ts";
import { SERVICE_UNIT_CODES } from "../src/features/platform/project-price-catalogs/service-units.ts";

const source = await readFile(new URL("../src/features/dispatches/components/dispatch-guide-dialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
function nodes(node) { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children), ...nodes(node.props?.lines)]; }
function text(node) { return node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children); }

function fixture() {
  const state = [];
  let cursor = 0;
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": {},
    react: {
      useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
      useRef: (value) => ({ current: value }), useEffect() {}, useActionState: (_action, initial) => [initial, () => {}, false], startTransition: (callback) => callback(),
    },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/features/vision-ocr/guide-draft": model, "../casting-elements": casting, "../guide-details": model,
    "../catalog-selection": { catalogSelectionDefaults }, "../../platform/project-price-catalogs/service-units": { SERVICE_UNIT_CODES },
    "../formatters": { formatDispatchMoney: (amount) => `Q ${amount}` }, "../types": { initialDispatchMutationState: { status: "idle" } },
    "@/lib/env": { getPublicEnvironment: () => ({ appEnvironment: "DEV" }) }, "@/lib/notification-messages": { notifications: {} },
    "@/components/feedback/use-action-notification": { useActionNotification() {} }, "../actions": {},
  };
  for (const [path, names] of [
    ["@/components/feedback/loading-button", ["LoadingButton"]], ["@/components/ui/button", ["Button"]], ["@/components/ui/dialog", ["Dialog", "DialogFooter"]], ["@/components/ui/icon-button", ["IconButton"]],
    ["@/features/vision-ocr/components/guide-photo-capture", ["GuidePhotoCapture"]], ["@/features/vision-ocr/components/guide-ocr-details", ["GuideOcrVariants", "SavedGuideOcrDetails"]],
    ["@/features/vision-ocr/components/guide-ocr-review", ["GuideOcrReview"]], ["./guide-resident-fields", ["GuideResidentFields"]], ["./guide-lines-list", ["GuideLinesList"]], ["./dispatch-catalog-combobox", ["DispatchCatalogCombobox"]],
  ]) imports[path] = Object.fromEntries(names.map((name) => [name, name]));
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl, crypto: { randomUUID }, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return () => { cursor = 0; return nodes(exports.DispatchGuideDialog({ projectId: "qa", programmingId: "qa", dispatchId: "qa", expectedVersion: 1, programmedUnitCode: "M3", units: [], onClose() {} })); };
}

test("las alertas de catálogo aparecen al inicio junto con las de lectura y conservan las alertas de cada línea", () => {
  const render = fixture();
  const warning = "Código fuera de la cotización del proyecto. Puedes guardar la guía con precio pendiente.";
  const known = { id: "known", code: "CONF4001", type: "PRODUCT", reference: "CONF4001", price: 100, currency: "GTQ" };
  const line = { quantity: "1", unit: "", productCode: "CONF4001", description: "Concreto", type: "PRODUCT", catalogItemId: "known", candidates: [known], warning: null };
  const draft = { guideNumber: "6015-000543", arrivalTime: "18:00", departureTime: "19:00", details: { ...model.emptyGuideDetails(), guideDate: "2026-11-03" }, confidence: {}, warnings: ["Confirma la fecha."], lines: [line, line, line, { ...line, productCode: "60090002", type: "SERVICE", catalogItemId: "", candidates: [], warning }, { ...line, productCode: "NUEVO", catalogItemId: "", candidates: [], warning }] };
  render().find((node) => node.type === "GuidePhotoCapture").props.onRead({ captureId: "qa", draft });
  let tree = render();
  const banner = tree.find((node) => node.props?.id === "guide-review-alerts");
  assert.match(text(banner), /Confirma la fecha/);
  assert.match(text(banner), /Línea 4 · Servicio 60090002/);
  assert.match(text(banner), /Línea 5 · Producto NUEVO/);
  assert.match(text(banner), /se registrará una incidencia/);
  assert.ok(tree.indexOf(banner) < tree.findIndex((node) => node.type === "GuideOcrReview"));
  assert.equal(tree.filter((node) => node.props?.role === "status" && text(node) === warning).length, 2);
  for (const code of ["60090002", "NUEVO"]) {
    tree.find((node) => node.type === "DispatchCatalogCombobox" && node.props.value === code).props.onSelect({ ...known, id: `selected-${code}`, code, type: code === "60090002" ? "SERVICE" : "PRODUCT", description: "Cotizado", unitCode: "UN" });
    tree = render();
  }
  assert.equal(text(tree.find((node) => node.props?.id === "guide-review-alerts")), "Confirma la fecha.");
});
