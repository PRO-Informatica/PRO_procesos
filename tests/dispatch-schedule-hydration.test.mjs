import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path, imports, intl) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Date, Intl: intl, require(name) {
    assert.ok(Object.hasOwn(imports, name), name);
    return imports[name];
  } });
  return exports;
}

function localeVariant(space) {
  const replace = text => text.replace(/[ \u00a0\u202f]/gu, space);
  return { NumberFormat: Intl.NumberFormat, DateTimeFormat: class extends Intl.DateTimeFormat {
    get format() { const format = super.format; return value => replace(format(value)); }
    formatToParts(value) { return super.formatToParts(value).map(part => part.type === "literal" ? { ...part, value: replace(part.value) } : part); }
  } };
}

const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
function renderSchedule(intl, value, timezone) {
  const formatters = load("features/dispatches/formatters.ts", { "@/lib/status-labels": {}, "./catalog-estimates": {} }, intl);
  const jsx = (type, props) => ({ type, props });
  const { DispatchesWorkspace } = load("features/dispatches/components/dispatches-workspace.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": {}, "next/link": {},
    react: { useMemo: fn => fn(), useState: initial => [initial, () => {}] },
    "../formatters": formatters,
    "@/features/programming/formatters": { formatProgrammingStatus: String, programmingStatusTone: () => "" },
    "@/features/programming/status-presentation": { getProgrammingDisplayStatus: value => value },
    "@/components/feedback/empty-state": { EmptyState: "EmptyState" },
    "@/components/motion/motion-page": { MotionPage: "MotionPage" },
    "@/components/motion/motion-section": { MotionSection: "MotionSection" },
    "./dispatch-badges": {}, "./dispatch-guide-dialog": {}, "./register-dispatch-dialog": {},
  }, intl);
  const tree = DispatchesWorkspace({
    project: { id: "project", timezone }, canCreate: false, canModify: false, receiverName: "Residente",
    data: { units: [], items: [{ programmingId: "programming", programmingCode: "PRG-TEST", programmingStatus: "CONFIRMED", scheduledAt: value, concreteTypes: [], dispatchId: null }] },
  });
  const schedule = nodes(tree).find(node => node.type?.name === "DispatchSchedule");
  assert.ok(schedule);
  const time = schedule.type(schedule.props);
  return { dateTime: time.props.dateTime, date: time.props.children[0].props.children, time: time.props.children[1].props.children };
}

test("DispatchSchedule produce el mismo texto exacto con espacios ICU distintos entre servidor y navegador", () => {
  const value = "2026-10-24T13:00:00Z", timezone = "America/Guatemala";
  const serverIntl = localeVariant("\u00a0"), clientIntl = localeVariant(" ");
  const options = { timeStyle: "short", timeZone: timezone };
  assert.notEqual(new serverIntl.DateTimeFormat("es-GT", options).format(new Date(value)), new clientIntl.DateTimeFormat("es-GT", options).format(new Date(value)));
  const server = renderSchedule(serverIntl, value, timezone);
  const client = renderSchedule(clientIntl, value, timezone);
  assert.deepEqual(server, client);
  assert.deepEqual(server, { dateTime: value, date: "24/10/2026", time: "7:00 a. m." });
  assert.doesNotMatch(server.date + server.time, /[\u00a0\u202f\u200e\u200f]/u);
});

test("el horario estable respeta medianoche, mediodía y el cambio de fecha de la zona del proyecto", () => {
  const { formatDispatchSchedule } = load("features/dispatches/formatters.ts", { "@/lib/status-labels": {}, "./catalog-estimates": {} }, Intl);
  for (const [value, timezone, expectedDate, expectedTime] of [
    ["2026-10-24T05:07:00Z", "America/Guatemala", "23/10/2026", "11:07 p. m."],
    ["2026-10-24T06:00:00Z", "America/Guatemala", "24/10/2026", "12:00 a. m."],
    ["2026-10-24T18:00:00Z", "America/Guatemala", "24/10/2026", "12:00 p. m."],
    ["2026-12-31T18:05:00Z", "Pacific/Kiritimati", "1/1/2027", "8:05 a. m."],
  ]) {
    const actual = formatDispatchSchedule(value, timezone);
    assert.equal(actual.date, expectedDate);
    assert.equal(actual.time, expectedTime);
  }
});
