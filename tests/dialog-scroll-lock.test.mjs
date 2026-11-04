import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the actual hook lifecycle, including React's parent-first cleanup.
// A small inline-style stand-in is sufficient: this is about lock ownership,
// not layout. Responsive/wheel/touch checks use the hydrated browser fixture.
function harness() {
  const effects = [];
  const document = { activeElement: null, body: { style: { overflow: "" } }, addEventListener() {}, removeEventListener() {} };
  const React = {
    useRef: (current) => ({ current }),
    useEffect: (effect) => effects.push(effect),
  };
  const imports = {
    react: React,
    "react/jsx-runtime": {},
    "react-dom": {},
    "lucide-react": {},
    "motion/react": {},
    "@/lib/class-names": {},
    "@/lib/motion/tokens": {},
    "./icon-button": {},
  };
  const exports = {};
  return { document, effects, exports, context: { exports, document, HTMLElement: class {}, require: (name) => {
    assert.ok(Object.hasOwn(imports, name), name);
    return imports[name];
  } } };
}
const source = await readFile(new URL("../src/components/ui/dialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function mountHook(fixture) {
  const start = fixture.effects.length;
  fixture.exports.useDialogAccessibility({ open: true, onClose() {} });
  const effects = fixture.effects.slice(start);
  return () => {
    const cleanups = effects.map((effect) => effect());
    return () => cleanups.forEach((cleanup) => cleanup?.());
  };
}

function createFixture(overflow = "") {
  const fixture = harness();
  fixture.document.body.style.overflow = overflow;
  runInNewContext(compiled, fixture.context);
  return fixture;
}

test("al desmontar dos ventanas juntas se restaura el scroll del despacho", () => {
  const fixture = createFixture();
  const closeParent = mountHook(fixture)();
  const closeChild = mountHook(fixture)();
  assert.equal(fixture.document.body.style.overflow, "hidden");
  closeParent();
  closeChild();
  assert.equal(fixture.document.body.style.overflow, "");
});

test("cerrar la ventana principal no desbloquea la página mientras quede otra abierta", () => {
  const fixture = createFixture("auto");
  const closeParent = mountHook(fixture)();
  const closeChild = mountHook(fixture)();
  closeParent();
  assert.equal(fixture.document.body.style.overflow, "hidden");
  closeChild();
  assert.equal(fixture.document.body.style.overflow, "auto");
});

test("cerrar la secundaria y después la principal conserva el estilo original", () => {
  const fixture = createFixture("scroll");
  const closeParent = mountHook(fixture)();
  const closeChild = mountHook(fixture)();
  closeChild();
  assert.equal(fixture.document.body.style.overflow, "hidden");
  closeParent();
  assert.equal(fixture.document.body.style.overflow, "scroll");
});

test("Strict Mode y varios ciclos de guías no dejan un bloqueo residual", () => {
  const fixture = createFixture();
  for (let cycle = 0; cycle < 4; cycle += 1) {
    const setup = mountHook(fixture);
    setup()(); // React Strict Mode: setup, cleanup, setup.
    const closeParent = setup();
    const closeChild = mountHook(fixture)();
    closeParent();
    closeChild();
    assert.equal(fixture.document.body.style.overflow, "");
  }
});

test("abrir otra guía durante un cierre conserva el bloqueo hasta el último cierre", () => {
  const fixture = createFixture();
  const closeParent = mountHook(fixture)();
  const closeChild = mountHook(fixture)();
  closeParent();
  const closeNextGuide = mountHook(fixture)();
  closeChild();
  assert.equal(fixture.document.body.style.overflow, "hidden");
  closeNextGuide();
  assert.equal(fixture.document.body.style.overflow, "");
});

test("una ventana cerrada no bloquea el scroll y se respeta un bloqueo ajeno previo", () => {
  const fixture = createFixture("hidden");
  fixture.exports.useDialogAccessibility({ open: false, onClose() {} });
  fixture.effects.forEach((effect) => effect()?.());
  const close = mountHook(fixture)();
  close();
  assert.equal(fixture.document.body.style.overflow, "hidden");
});
