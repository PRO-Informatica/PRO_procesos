import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { historicalGuideMigration } from "../scripts/lib/historical-guide-migrations.mjs";
import { guideReportMetadata } from "../src/features/reports/guide-metadata.ts";
import { makeRadarGuide, filterRadarDispatches } from "../src/features/reports/radar.ts";
import { buildRadarWorkbook } from "../src/features/reports/radar-workbook.ts";
import { CASTING_ELEMENTS } from "../src/features/dispatches/casting-elements.ts";

test("el plan de PROD mantiene nulos los campos nuevos sin cambiar las migraciones ya aplicadas en DEV", async () => {
  for (const [version, name] of [["136", "guide_resident_fields_optional_units"], ["137", "guide_manual_details"], ["139", "programming_casting_control_guides"]]) {
    const source = await readFile(new URL(`../supabase/migrations/${version}_${name}.sql`, import.meta.url), "utf8");
    const planned = historicalGuideMigration(version, source);
    assert.notEqual(planned, source);
    assert.doesNotMatch(planned, /add column (?:laboratory_applied|details)[^;]*not null/u);
    assert.doesNotMatch(planned, /^update public\.(programming|dispatch_guides)/mu);
    assert.match(source, /not null default|^update public\.programming/mu);
    assert.match(planned, /create function|create or replace function/u);
  }
  assert.throws(() => historicalGuideMigration("136", "unexpected"), /prerequisite changed/);
});

test("los registros históricos sin laboratorio no se interpretan como No ni se modifican al leerlos", () => {
  const row = { id: "legacy", guide_number: "001", guide_date: "2026-11-03", casting_element: null, laboratory_applied: null, details: null };
  const original = structuredClone(row);
  const guide = makeRadarGuide(row, []);
  assert.equal(guide.laboratory, null);
  assert.equal(guide.castingElement, "Sin registrar");
  assert.equal(guide.truck, "");
  assert.equal(guideReportMetadata([row]).laboratoryLabel, "Sin registrar");
  assert.equal(guideReportMetadata([row, { laboratory_applied: false }]).laboratoryLabel, "No en 1 guía(s); 1 sin registrar");
  const dispatch = { id: "d", code: "DSP-LEGACY", scheduledAt: "2026-11-03T13:00:00Z", timezone: "America/Guatemala", guides: [guide], summary: { castingElements: [], castingElementLabel: "Sin registrar" } };
  const filters = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };
  assert.equal(filterRadarDispatches([dispatch], filters).length, 1);
  for (const laboratory of ["yes", "no"]) assert.equal(filterRadarDispatches([dispatch], { ...filters, laboratory }).length, 0);
  assert.equal(buildRadarWorkbook([dispatch]).worksheets[0].getCell("J8").value, "Sin registrar");
  assert.deepEqual(row, original);
});

test("el residente debe elegir Sí o No cuando abre una guía histórica sin laboratorio registrado", async () => {
  const source = await readFile(new URL("../src/features/dispatches/components/guide-resident-fields.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}, jsx = (type, props) => ({ type, props });
  runInNewContext(compiled, { exports, require: (name) => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : { CASTING_ELEMENTS } });
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  let selected;
  const tree = nodes(exports.GuideResidentFields({ element: "", laboratory: null, disabled: false, onElement() {}, onLaboratory: (value) => { selected = value; } }));
  const field = tree.find((node) => node.props?.id === "guide-laboratory-applied");
  assert.equal(field.type, "select");
  assert.equal(field.props.value, "");
  assert.equal(field.props.required, true);
  field.props.onChange({ target: { value: "no" } });
  assert.equal(selected, false);
});
