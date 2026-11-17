import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { CASTING_ELEMENTS } from "../src/features/dispatches/casting-elements.ts";
import { emptyGuideDetails, validateGuideDetails } from "../src/features/dispatches/guide-details.ts";

const source = await readFile(new URL("../src/features/dispatches/components/guide-resident-fields.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {}, jsx = (type, props) => ({ type, props });
runInNewContext(compiled, { exports, require: (name) => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : { CASTING_ELEMENTS } });
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const render = (props) => nodes(exports.GuideResidentFields({ element: "", elementObservations: "", laboratory: false, disabled: false, onElement() {}, onElementObservations() {}, onLaboratory() {}, ...props }));

test("las observaciones solo aparecen debajo del selector al elegir un elemento válido", () => {
  for (const element of ["", "INVALID"]) assert.ok(!render({ element }).some((node) => node.type === "textarea"));
  for (const element of Object.keys(CASTING_ELEMENTS)) {
    const tree = render({ element });
    const fieldIndex = tree.findIndex((node) => node.type === "textarea");
    assert.ok(fieldIndex > tree.findIndex((node) => node.props?.id === "guide-casting-element"));
    const field = tree[fieldIndex];
    assert.equal(field.props.required, undefined);
    assert.equal(field.props.maxLength, 4000);
    assert.equal(field.props.rows, 3);
    assert.ok(tree.some((node) => node.type === "label" && node.props.htmlFor === field.props.id && node.props.children === "Observaciones Elemento a fundir"));
  }
});

test("conserva notas multilínea, permite editarlas y respeta solo lectura y guías sin laboratorio", () => {
  let entered;
  const value = "Columnas del eje A\nFundir hasta nivel 2.";
  for (const disabled of [false, true]) {
    const tree = render({ element: "COLUMNS", elementObservations: value, disabled, showLaboratory: false, onElementObservations: (next) => { entered = next; } });
    const field = tree.find((node) => node.type === "textarea");
    assert.equal(field.props.value, value);
    assert.equal(field.props.disabled, disabled);
    assert.ok(!tree.some((node) => node.props?.id === "guide-laboratory-applied"));
    if (!disabled) field.props.onChange({ target: { value: "Pilotes pendientes" } });
  }
  assert.equal(entered, "Pilotes pendientes");
});

test("el campo es opcional en datos históricos y admite hasta 4000 caracteres sin mezclar observaciones", () => {
  const details = { ...emptyGuideDetails(), observations: "Nota general", castingElementObservations: "x".repeat(4000) };
  assert.equal(validateGuideDetails(details), null);
  for (const value of [null, false, 42, "x".repeat(4001)]) assert.ok(validateGuideDetails({ ...details, castingElementObservations: value }));
  delete details.castingElementObservations;
  assert.equal(validateGuideDetails(details), null);
  assert.equal(details.observations, "Nota general");
  assert.equal(emptyGuideDetails().castingElementObservations, "");
});
