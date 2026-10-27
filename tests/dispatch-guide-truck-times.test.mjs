import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { validateDispatchGuideLines, validateGuideTruckTimes } from '../src/features/dispatches/validation.ts';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/features/dispatches/actions.ts', root), 'utf8');
const dialogSource = await readFile(new URL('src/features/dispatches/components/dispatch-guide-dialog.tsx', root), 'utf8');
function load(source, imports) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(js, { exports, require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`); return imports[name]; }, Intl, Date });
  return exports;
}
const projectId = '78f495d6-d721-4b65-94f0-fdc94a03b8df';
const dispatchId = '38f495d6-d721-4b65-94f0-fdc94a03b8df';
const guideId = '28f495d6-d721-4b65-94f0-fdc94a03b8df';

test('horas del camión obligatorias, válidas, ordenadas y sin cruce de medianoche', () => {
  for (const pair of [['', '12:00'], ['12:00', ''], ['24:00', '24:01'], ['12:60', '13:00'], ['13:00', '12:00'], ['9:00', '10:00'], ['23:00', '00:10']]) assert.ok(validateGuideTruckTimes(...pair));
  for (const pair of [['00:00', '00:00'], ['09:05', '23:59'], ['15:30', '15:30']]) assert.equal(validateGuideTruckTimes(...pair), null);
});

function actionFixture({ permission = true, rpcError = null } = {}) {
  const calls = [], paths = [];
  const actions = load(source, {
    'next/cache': { revalidatePath: value => paths.push(value) },
    '@/features/auth/queries': { requireActiveProfile: async () => ({ id: projectId }) },
    '@/features/projects/queries': { getProjectContext: async () => ({ status: 'ready', activeProject: { id: projectId }, permissions: permission ? ['dispatch.modify'] : [] }) },
    '@/lib/supabase/admin': {}, './registration': {},
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (name, args) => { calls.push({name, args}); return { data: name.startsWith('create') ? { guide_id: guideId, dispatch_version: 3 } : 3, error: rpcError }; } }) },
    './validation': { validateDispatchGuideLines, validateGuideTruckTimes },
  });
  return { save: actions.saveDispatchGuideAction, calls, paths };
}
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectId, dispatchId, guideId: '', expectedVersion: '2', guideNumber: '1234', guideDate: '2026-10-26', truckArrivalTime: '15:30', truckDepartureTime: '16:10', lineId: '', lineQuantity: '5', lineUnitCode: 'M3', lineCatalogType: 'PRODUCT', lineCatalogItemId: projectId, lineProductDescription: 'CONF4001', ...overrides })) data.set(key, value);
  return data;
}
for (const [id, rpc] of [['', 'create_dispatch_guide_with_lines'], [guideId, 'update_dispatch_guide_with_lines']]) {
  test(`${rpc} transmite los dos horarios al RPC y refresca el despacho`, async () => {
    const f = actionFixture();
    const result = await f.save({}, form({ guideId: id }));
    assert.equal(result.status, 'success'); assert.equal(result.newVersion, 3);
    assert.equal(f.calls[0].name, rpc);
    assert.equal(f.calls[0].args.p_truck_arrival_time, '15:30');
    assert.equal(f.calls[0].args.p_truck_departure_time, '16:10');
    assert.equal(f.calls[0].args.p_guide_date, '2026-10-26');
    assert.ok(f.paths.includes(`/dispatches/${dispatchId}`));
  });
}
test('crear y editar admiten una guía formada únicamente por servicios', async () => {
  for (const id of ['', guideId]) {
    const f = actionFixture();
    const result = await f.save({}, form({guideId:id,lineCatalogType:'SERVICE',lineUnitCode:'M2',lineProductDescription:'Aplicación de curador',truckArrivalTime:'07:00',truckDepartureTime:'07:02'}));
    assert.equal(result.status,'success');
    assert.equal(f.calls[0].args.p_lines.length,1);
    assert.equal(f.calls[0].args.p_lines[0].catalog_type,'SERVICE');
    assert.equal(f.calls[0].args.p_lines[0].unit_code,'M2');
    assert.equal(f.calls[0].args.p_lines[0].product_description,'Aplicación de curador');
    assert.equal(f.calls[0].args.p_truck_arrival_time,'07:00');
  }
});
test('no escribe con horarios omitidos, inválidos o sin permisos', async () => {
  for (const overrides of [{truckArrivalTime:''}, {truckDepartureTime:''}, {truckArrivalTime:'18:00'}, {truckDepartureTime:'99:99'}]) {
    const f = actionFixture(); assert.equal((await f.save({},form(overrides))).status,'error'); assert.equal(f.calls.length,0);
  }
  const f = actionFixture({permission:false}); assert.equal((await f.save({},form())).status,'error'); assert.equal(f.calls.length,0);
});
test('errores de horario y conflictos no se muestran como éxito ni refrescan datos', async () => {
  for (const [message, pattern] of [['GUIDE_TRUCK_TIMES_REQUIRED',/horas/], ['GUIDE_TRUCK_INVALID_TIME_SEQUENCE',/anterior/], ['GUIDE_TRUCK_DATE_MISMATCH',/día/], ['DISPATCH_VERSION_CONFLICT',/cambió/], ['DISPATCH_COMPLETED_NOT_EDITABLE',/completado/]]) {
    const f = actionFixture({rpcError:{message}}); const result=await f.save({},form());
    assert.equal(result.status,'error'); assert.match(result.message,pattern); assert.equal(f.paths.length,0);
  }
});

function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node,...nodes(node.props?.children)]; }
function dialogFixture({readOnly=false,guide}={}) {
  const jsx = (type, props) => ({type,props});
  const dialog = load(dialogSource, {
    'react/jsx-runtime': {jsx,jsxs:jsx},
    react: { useActionState: () => [{status:'idle'},()=>{},false], useState: value => [typeof value==='function'?value():value,()=>{}], useEffect(){}, useMemo: fn=>fn() },
    'next/navigation': {useRouter:()=>({refresh(){}})},
    'lucide-react': {PackageOpen:'Icon',Plus:'Icon',Search:'Icon',Trash2:'Icon'},
    '@/components/feedback/loading-button': {LoadingButton:'LoadingButton'},
    '@/components/feedback/use-action-notification': {useActionNotification(){}},
    '@/components/ui/button': {Button:'Button'}, '@/components/ui/dialog': {Dialog:'Dialog',DialogFooter:'DialogFooter'},
    '@/components/ui/icon-button': {IconButton:'IconButton'}, '@/lib/notification-messages': {notifications:{}},
    '../actions': {saveDispatchGuideAction(){}}, '../catalog-selection': {catalogSelectionDefaults(){}},
    '../../platform/project-price-catalogs/service-units': {SERVICE_UNIT_CODES:['M3']},
    '../formatters': {formatDispatchMoney:value=>String(value)}, '../types': {initialDispatchMutationState:{status:'idle'}},
    './dispatch-catalog-combobox': {DispatchCatalogCombobox:'Picker'},
  }).DispatchGuideDialog;
  return nodes(dialog({projectId,dispatchId,programmingId:projectId,expectedVersion:2,programmedUnitCode:'M3',units:[{code:'M3'}],timezone:'America/Guatemala',guide,readOnly,onClose(){}}));
}
test('formulario nuevo muestra ambas horas obligatorias sin inventar valores', () => {
  const tree=dialogFixture();
  for (const name of ['truckArrivalTime','truckDepartureTime']) {
    const input=tree.find(n=>n.type==='input'&&n.props.name===name);
    assert.equal(input.props.type,'time'); assert.equal(input.props.required,true); assert.equal(input.props.value,''); assert.equal(input.props.disabled,false);
    assert.ok(tree.some(n=>n.type==='label'&&n.props.htmlFor===input.props.id));
  }
});
test('editar/ver usa la zona del proyecto y conserva modo de solo lectura', () => {
  const tree=dialogFixture({readOnly:true,guide:{id:guideId,guideNumber:'1234',guideDate:'2026-10-26',truckArrivalAt:'2026-10-26T21:30:00Z',truckDepartureAt:'2026-10-26T22:10:00Z',lines:[]}});
  assert.equal(tree.find(n=>n.type==='input'&&n.props.name==='truckArrivalTime').props.value,'15:30');
  const exit=tree.find(n=>n.type==='input'&&n.props.name==='truckDepartureTime'); assert.equal(exit.props.value,'16:10'); assert.equal(exit.props.min,'15:30'); assert.equal(exit.props.disabled,true);
});

test('las consultas trasladan horarios nuevos e históricos sin fabricar datos', async () => {
  const queries = await readFile(new URL('src/features/dispatches/queries.ts',root),'utf8');
  const loadedQueries = load(queries+'\nexport { buildGuides as testBuildGuides };', {
    'server-only':{}, '@/lib/supabase/admin':{}, '@/lib/supabase/server':{}, './formatters':{},
  });
  const guide={id:guideId,guide_number:'1234',guide_date:'2026-10-26',quantity:5,unit_code:'M3',truck_arrival_at:'2026-10-26T21:30:00Z',truck_departure_at:'2026-10-26T22:10:00Z'};
  const row=loadedQueries.testBuildGuides([guide],[])[0];
  assert.equal(row.truckArrivalAt,guide.truck_arrival_at); assert.equal(row.truckDepartureAt,guide.truck_departure_at);
  const legacy=loadedQueries.testBuildGuides([{...guide,truck_arrival_at:null,truck_departure_at:null}],[])[0];
  assert.equal(legacy.truckArrivalAt,null); assert.equal(legacy.truckDepartureAt,null);
  assert.equal(queries.match(/\.select\("id, dispatch_id, guide_number, guide_date, truck_arrival_at, truck_departure_at, quantity, unit_code"\)/gu).length,2);
});
