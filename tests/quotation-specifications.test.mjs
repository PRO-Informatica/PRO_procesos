import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseProjectPriceCatalog } from '../src/features/platform/project-price-catalogs/parser.ts';
import { productSpecifications } from '../src/features/platform/project-price-catalogs/specifications.ts';
import { withQuotationSpecifications } from '../src/features/reports/quotation-specifications.ts';
import { makeRadarGuide } from '../src/features/reports/radar.ts';
import { buildConcreteControl } from '../src/features/reports/concrete-control.ts';
import { buildConcreteControlWorkbook } from '../src/features/reports/concrete-control-workbook.ts';
import { buildRadarWorkbook } from '../src/features/reports/radar-workbook.ts';

async function file(rows) {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Productos').addRows(rows);
  return new File([await wb.xlsx.writeBuffer()], 'cotizacion.xlsx');
}
const header = ['Código', 'Referencia', 'Precio', 'Resistencia (PSI) 28 días', 'Slump en Obra'];

test('cotización importa PSI y tolerancia de slump sin cambiar precio, código ni referencia', async () => {
  const result = await parseProjectPriceCatalog(await file([header,
    ['86131064', 'CONF4001', 1224.16, 4000, ' 3 +/-1" '],
    ['002', 'CON.5001', 0, '5,000 PSI', '5 ± 1"'],
    ['003', 'Sin dato', 100, null, null],
  ]), 'PRODUCT');
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(r => [r.code, r.reference, r.price, r.resistancePsi, r.slump]), [
    ['86131064', 'CONF4001', '1224.16', 4000, '3 +/-1"'], ['002', 'CON.5001', '0', 5000, '5 ± 1"'], ['003', 'Sin dato', '100', null, null],
  ]);
  const old = await parseProjectPriceCatalog(await file([header.slice(0, 3), ['1', 'CON', 10]]), 'PRODUCT');
  assert.equal(Object.hasOwn(old.rows[0], 'resistancePsi'), false);
  assert.equal(Object.hasOwn(old.rows[0], 'slump'), false);
});

test('validación técnica rechaza PSI inválido, fórmulas y notas fuera del límite', async () => {
  for (const psi of ['0', '-1', '4000.5', '100000', 'texto', '1e3']) assert.ok(productSpecifications(psi, '').error, psi);
  assert.equal(productSpecifications('4 000', '').resistancePsi, 4000);
  assert.equal(productSpecifications('', '').resistancePsi, null);
  assert.ok(productSpecifications('', 'x'.repeat(121)).error);
  const result = await parseProjectPriceCatalog(await file([header,
    ['A', 'CON', 10, { formula: '2000*2', result: 4000 }, '3"'],
    ['B', 'CON', 10, 4000, { formula: '"3"', result: '3' }],
    ['C', 'CON', 10, 4000, 'Nota\ninterna'],
    [null, null, null, 4000, '3"'],
  ]), 'PRODUCT');
  assert.equal(result.errorCount, 4);
  assert.match(result.rows[3].errors.join(' '), /código.*obligatorio/u);
});

const quoted = { id: 'product', project_id: 'p', code: '86131064', reference: 'CONF4001', resistance_psi: 4000, slump: '3 +/-1"', price: 9999 };
const raw = { product_price_id: 'product', project_id: 'p', product_code: '86131064', catalog_reference: 'CONF4001', product_description: 'Concreto', quantity: 6.5, unit_code: 'M3', catalog_type: 'PRODUCT', unit_price: 100, estimated_subtotal: 650, currency: 'GTQ' };

test('metadatos completan guías antiguas por ID o clave exacta de proyecto, sin modificar costos históricos', () => {
  const originals = [raw, { ...raw, product_price_id: null }, { ...raw, project_id: 'ajeno' }, { ...raw, catalog_type: 'SERVICE' }, { ...raw, product_price_id: null, catalog_reference: 'otra' }];
  const enriched = withQuotationSpecifications(originals, [quoted]);
  assert.deepEqual(enriched.slice(0, 2).map(r => [r.resistance_psi, r.slump, r.unit_price, r.estimated_subtotal]), [[4000, '3 +/-1"', 100, 650], [4000, '3 +/-1"', 100, 650]]);
  for (const r of enriched.slice(2)) assert.equal(r.resistance_psi, undefined);
  assert.equal(raw.resistance_psi, undefined);
});

const dispatch = guide => ({ id: 'd', code: 'DSP-QA', projectName: 'Proyecto QA', projectId: 'p', orderNumber: '88', programmingCode: 'PRG-QA', supplierName: 'Proveedor QA', scheduledAt: '2026-11-01T13:00:00Z', timezone: 'America/Guatemala', guides: [guide], summary: {} });
const controlForGuide = guide => buildConcreteControl(dispatch(guide));
const cell = (sheet, header) => sheet.getCell(6, sheet.getRow(5).values.indexOf(header));

test('Radar conserva slump medido y distingue el cotizado; Control agrupa por PSI cotizado y conserva el promedio', async () => {
  const lines = withQuotationSpecifications([raw], [quoted]);
  const guide = makeRadarGuide({ id: 'g', guide_number: '001', guide_date: '2026-11-01', laboratory_applied: true, details: {} }, lines);
  assert.match(guide.concrete, /4000 PSI/u);
  assert.equal(guide.slump, 'Cotización: 3 +/-1"');
  const measured = makeRadarGuide({ id: 'g', laboratory_applied: true, details: { slump: '8 1/2"' } }, lines);
  assert.equal(measured.slump, '8 1/2"');
  const control = controlForGuide(guide);
  assert.deepEqual([...control.strengths.keys()], [4000]);
  assert.equal(control.concrete.value, 650);
  assert.equal(control.consumedVolume, 3.25);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildConcreteControlWorkbook([dispatch(guide)]).xlsx.writeBuffer());
  const sheet = workbook.worksheets[0];
  assert.equal(cell(sheet, '4000 PSI (m³)').value, 6.5);
  assert.equal(cell(sheet, 'Costo 4000 PSI (Q/m³)').value, 100);
  assert.equal(cell(sheet, 'Subtotal 4000 PSI (Q)').value, 650);
  assert.equal(sheet.rowCount, 7);
  const radar = new ExcelJS.Workbook();
  await radar.xlsx.load(await buildRadarWorkbook([dispatch(guide)]).xlsx.writeBuffer());
  assert.match(radar.worksheets[0].getCell('D8').value, /4000 PSI/u);
  assert.equal(radar.worksheets[0].getCell('I8').value, 'Cotización: 3 +/-1"');
});

test('el concreto se cruza por referencia/código únicos o la programación, sin mezclar concretos ni proyectos', () => {
  const unknown = { ...raw, guide_id: 'g', product_price_id: null, product_code: '', catalog_reference: '' };
  const plan = new Map([['g', [' conf.4001 ']]]);
  const [resolved] = withQuotationSpecifications([unknown], [quoted], plan);
  assert.equal(resolved.resistance_psi, 4000);
  assert.equal(resolved.slump, '3 +/-1"');
  assert.equal(resolved.quotation_unit_price, 9999);
  assert.equal(resolved.quotation_from_programming, true);
  assert.equal(resolved.product_code, ''); // The report never edits the original guide.
  for (const missing of [{ product_code: '86131064', catalog_reference: '' }, { product_code: '', catalog_reference: 'conf.4001' }, { product_code: 'CONF4001', catalog_reference: '' }]) {
    assert.equal(withQuotationSpecifications([{ ...unknown, ...missing }], [quoted])[0].resistance_psi, 4000);
  }
  for (const [line, catalog, programming] of [
    [unknown, [quoted], new Map([['g', ['CONF4001', 'CONF5001']]])],
    [unknown, [quoted, { ...quoted, id: 'other', code: 'OTHER' }], plan],
    [{ ...unknown, project_id: 'other-project' }, [quoted], plan],
    [{ ...unknown, product_code: 'CONCRETO-DIFERENTE' }, [quoted], plan],
    [{ ...unknown, catalog_type: 'SERVICE' }, [quoted], plan],
    [{ ...unknown, unit_code: 'UN' }, [quoted], plan],
  ]) assert.equal(withQuotationSpecifications([line], catalog, programming)[0].resistance_psi, undefined);
  const other = { ...quoted, id: 'second', code: '222', reference: 'CONF5001', resistance_psi: 5000 };
  const explicit = withQuotationSpecifications([{ ...unknown, product_code: '222', catalog_reference: 'CONF5001' }], [quoted, other], plan)[0];
  assert.equal(explicit.resistance_psi, 5000); // Actual delivered concrete wins over the plan.
});

test('Slump del Radar solo se muestra con laboratorio, conserva el medido y el amarillo de toda la fila', async () => {
  const lines = withQuotationSpecifications([raw], [quoted]);
  const guides = [true, false, null].map((lab, i) => makeRadarGuide({ id: String(i), guide_number: String(i), laboratory_applied: lab, details: { slump: '8 1/2"' } }, lines));
  assert.deepEqual(guides.map(g => g.slump), ['8 1/2"', '', '']);
  const onlyServices = makeRadarGuide({ laboratory_applied: true, details: { slump: '8"' } }, [{ ...raw, catalog_type: 'SERVICE', slump: '3"' }]);
  assert.equal(onlyServices.slump, '');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildRadarWorkbook([{ ...dispatch(guides[0]), guides }]).xlsx.writeBuffer());
  const sheet = wb.worksheets[0];
  assert.equal(sheet.getCell('I8').value, '8 1/2"');
  for (const col of ['A', 'C', 'I', 'J']) assert.equal(sheet.getCell(`${col}8`).fill.fgColor.argb, 'FFFFE066');
  for (const row of [9, 10]) {
    assert.equal(sheet.getCell(`I${row}`).value, null);
    assert.equal(sheet.getCell(`A${row}`).fill.fgColor?.argb, undefined);
  }
});

test('Control usa precio histórico y solo completa faltantes con cotización, incluyendo fórmulas y observaciones', async () => {
  const product = { ...quoted, price: 1224.16 };
  const noPrice = { ...raw, unit_price: null, estimated_subtotal: null, currency: null };
  const lines = withQuotationSpecifications([noPrice], [product]);
  const note = 'Columnas del eje B hasta nivel 2';
  const guide = makeRadarGuide({ id: 'g', guide_number: '001', guide_date: '2026-11-01', details: { observations: 'No usar esta nota', castingElementObservations: note } }, lines);
  const control = controlForGuide(guide);
  assert.equal(control.strengths.get(4000).unitPrice, 1224.16);
  assert.equal(control.concrete.value, 7957.04);
  assert.equal(guide.lines[0].unitPrice, null);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildConcreteControlWorkbook([dispatch(guide)]).xlsx.writeBuffer());
  const sheet = wb.worksheets[0];
  assert.equal(cell(sheet, '4000 PSI (m³)').value, 6.5);
  assert.equal(cell(sheet, 'Costo 4000 PSI (Q/m³)').value, 1224.16);
  assert.equal(cell(sheet, 'Subtotal 4000 PSI (Q)').value, 7957.04);
  assert.equal(cell(sheet, 'Total (Q)').result, 7957.04);
  assert.equal(cell(sheet, 'Observaciones').value, note);
  assert.match(JSON.stringify(cell(sheet, 'Observaciones').note), /precio de cotización/);
  assert.equal(sheet.rowCount, 7);
  for (const [snapshot, expected] of [
    [{ ...raw }, 650],
    [{ ...raw, unit_price: 0, estimated_subtotal: 0 }, 0],
    [{ ...raw, unit_price: null, estimated_subtotal: 650 }, 650],
    [{ ...noPrice, currency: 'USD' }, null],
    [{ ...noPrice, catalog_type: 'SERVICE' }, null],
  ]) {
    const g = makeRadarGuide({}, withQuotationSpecifications([snapshot], [product]));
    assert.equal(controlForGuide(g).total.value, expected);
  }
});

test('dos concretos con igual PSI conservan sus propios precios y Slump, sin buscar por resistencia', () => {
  const products = [quoted, { ...quoted, id: 'other', code: '222', reference: 'OTRO4000', price: 1500, slump: '5 +/-1"' }];
  const rows = [raw, { ...raw, product_price_id: 'other', product_code: '222', catalog_reference: 'OTRO4000' }]
    .map(line => ({ ...line, unit_price: null, estimated_subtotal: null, currency: null }));
  const guides = withQuotationSpecifications(rows, products).map((line, i) => makeRadarGuide({ id: String(i), laboratory_applied: true }, [line]));
  assert.deepEqual(guides.map(g => g.slump), ['Cotización: 3 +/-1"', 'Cotización: 5 +/-1"']);
  assert.deepEqual(guides.map(g => controlForGuide(g).strengths.get(4000).unitPrice), [9999, 1500]);
  assert.equal(controlForGuide(makeRadarGuide({}, withQuotationSpecifications([{ ...rows[0], unit_price: 0, currency: 'GTQ' }], products))).concrete.value, 0);
  assert.equal(controlForGuide(makeRadarGuide({}, withQuotationSpecifications([rows[0]], [{ ...quoted, price: 0 }]))).concrete.value, 0);
});

const company = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const product = '33333333-3333-4333-8333-333333333333';
const actionSource = await readFile(new URL('../src/features/platform/project-price-catalogs/actions.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(actionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function actionFixture({ admin = true, allowedProject = true, rpcError = null, rpcThrows = false } = {}) {
  const calls = [], exports = {};
  const query = { select() { return query; }, eq(...args) { calls.push(['eq', ...args]); return query; }, async maybeSingle() { return { data: allowedProject ? { id: project } : null, error: null }; } };
  const imports = { 'next/cache': { revalidatePath: (...args) => calls.push(['revalidate', ...args]) }, '@/features/platform/queries': { isPlatformAdmin: async () => admin }, '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'user' } } }) }, from: () => query, rpc: async (...args) => { calls.push(['rpc', ...args]); if (rpcThrows) throw Error('Network'); return { error: rpcError }; } }) }, './parser': { parseProjectPriceCatalog }, './specifications': { productSpecifications } };
  runInNewContext(compiled, { exports, FormData, File, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { calls, ...exports };
}
function form() {
  const f = new FormData();
  for (const [key, value] of Object.entries({ companyId: company, projectId: project, productId: product, updatedAt: '2026-11-17T12:00:00Z', resistancePsi: '4000', slump: '3 +/-1"' })) f.set(key, value);
  return f;
}
test('editar exige admin y pertenencia; envía solo metadatos y versión, maneja conflicto y error de red', async () => {
  for (const options of [{ admin: false }, { allowedProject: false }]) {
    const f = actionFixture(options); assert.equal((await f.updateProductSpecificationsAction(form())).status, 'error');
    assert.equal(f.calls.filter(c => c[0] === 'rpc').length, 0);
  }
  const f = actionFixture(); assert.equal((await f.updateProductSpecificationsAction(form())).status, 'success');
  const call = f.calls.find(c => c[0] === 'rpc');
  assert.equal(call[1], 'platform_update_product_specifications');
  assert.deepEqual(JSON.parse(JSON.stringify(call[2])), { p_company_id: company, p_project_id: project, p_product_id: product, p_resistance_psi: 4000, p_slump: '3 +/-1"', p_expected_updated_at: '2026-11-17T12:00:00Z' });
  const invalid = form(); invalid.set('resistancePsi', '-1');
  assert.equal((await f.updateProductSpecificationsAction(invalid)).status, 'error');
  assert.match((await actionFixture({ rpcError: { message: 'CATALOG_CONFLICT' } }).updateProductSpecificationsAction(form())).message, /cambió/u);
  assert.equal((await actionFixture({ rpcThrows: true }).updateProductSpecificationsAction(form())).status, 'error');
});

test('importación envía omisión, vacío y valor técnico sin confundirlos', async () => {
  for (const [rows, expected] of [
    [[header.slice(0, 3), ['1', 'CON', 10]], { code: '1', reference: 'CON', price: '10' }],
    [[header, ['1', 'CON', 10, null, null]], { code: '1', reference: 'CON', price: '10', resistance_psi: null, slump: null }],
    [[header, ['1', 'CON', 10, 4000, '3"']], { code: '1', reference: 'CON', price: '10', resistance_psi: 4000, slump: '3"' }],
  ]) {
    const f = actionFixture(), data = form();
    data.set('catalogKind', 'PRODUCT'); data.set('mode', 'UPDATE'); data.set('file', await file(rows));
    assert.equal((await f.importProjectPriceCatalogAction(data)).status, 'success');
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c => c[0] === 'rpc')[2].p_rows[0])), expected);
  }
});
