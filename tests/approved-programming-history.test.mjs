import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { isValidApprovedProgrammingDateTime } from '../src/features/programming/approved-import-validation.ts';

const root = new URL('../',import.meta.url);
const actionSource = await readFile(new URL('src/features/programming/actions.ts',root),'utf8');
const dialogSource = await readFile(new URL('src/features/programming/components/bulk-programming-dialog.tsx',root),'utf8');
function load(source,imports) {
  const exports = {};
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(js,{exports,require(name){assert.ok(Object.hasOwn(imports,name),`Unexpected import ${name}`);return imports[name];},Intl,Date,File});
  return exports;
}
const projectId='78f495d6-d721-4b65-94f0-fdc94a03b8df';
const supplierId='38f495d6-d721-4b65-94f0-fdc94a03b8df';
const row={sourceRow:25,scheduledAt:'2026-10-24T07:00',supplierId,quantity:'24',unitCode:'M3',orderNumber:'106',concreteType:'CONF4001',deliveryModes:['PUMP','PLACEMENT'],placementElement:'Pilotes',additions:'Tubos adicionales',truckInterval:'20',notes:'Del Excel original',errors:[]};

test('fechas históricas, futuras y bisiestas se validan por su valor calendario',()=>{
  for(const value of ['2020-01-01T00:00','2026-10-24T07:00','2030-12-31T23:59','2024-02-29T08:00']) assert.equal(isValidApprovedProgrammingDateTime(value),true,value);
  for(const value of ['','2026-02-29T08:00','2026-02-30T08:00','2026-13-01T08:00','2026-01-01T24:00','2026-01-01T12:60','2026-01-01T7:00','2026-01-01','0000-01-01T12:00','infinity','2026-10-24T07:00Z']) assert.equal(isValidApprovedProgrammingDateTime(value),false,value);
});

const rowErrors=load(dialogSource+'\nexport { rowErrors as testRowErrors };',{
  'react/jsx-runtime':{},react:{},'lucide-react':{},
  '@/components/feedback/loading-button':{},'@/components/forms/file-drop-field':{},'@/components/ui/dialog':{},
  '@/lib/notification-messages':{},'@/lib/notify':{},'../actions':{},'../invoice-policy':{},
  '../approved-import-validation':{isValidApprovedProgrammingDateTime},'../types':{},
}).testRowErrors;
test('la vista previa permite un día pasado y mantiene los campos obligatorios',()=>{
  assert.equal(rowErrors(row).length,0);
  for(const patch of [{scheduledAt:'2026-02-30T07:00'},{quantity:'0'},{quantity:'text'},{supplierId:''},{unitCode:''},{orderNumber:''},{concreteType:''},{placementElement:''}]) assert.ok(rowErrors({...row,...patch}).length>0);
});

function fixture({permission=true,activeProjectId=projectId,rows=[row],parserError=null,m3=true,rpcError=null}={}) {
  const calls=[],extracts=[],paths=[];
  const actions=load(actionSource,{
    'next/cache':{revalidatePath:p=>paths.push(p)},
    '@/features/auth/queries':{requireActiveProfile:async()=>({id:projectId})},
    '@/features/projects/queries':{getProjectContext:async()=>({status:'ready',activeProject:{id:activeProjectId,code:'QA',name:'QA',timezone:'America/Guatemala',billingLegalName:'QA, S.A.',address:'QA Address'},projects:[],permissions:permission?['programming.create']:[]})},
    '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:{programming_ids:[projectId]},error:rpcError};}})},
    './queries':{getProgrammingCatalogs:async()=>({suppliers:[{id:supplierId,code:'MIXTO',name:'Mixto Listo'}],units:m3?[{code:'M3'}]:[]})},
    './invoice-policy':{},'./types':{},
    './mixto-listo-workbook':{MIXTO_WORKBOOK_ERROR:'Invalid workbook',isValidApprovedProgrammingDateTime,extractMixtoProgrammingWorkbook:async(file,project)=>{extracts.push({file,project});if(parserError)throw Error(parserError);return{rows,warnings:[]};}},
  });
  return{actions,calls,extracts,paths};
}
function form(patches={}) {
  const form=new FormData();
  form.set('projectId',projectId);
  form.set('workbook',new File(['original Excel'],'approved.xlsx'));
  form.set('rows',JSON.stringify([{...row,scheduledAt:'2030-01-01T12:00',quantity:999,orderNumber:'FORGED',...patches}]));
  return form;
}
test('preview y guardado admiten fechas históricas y releen fecha/pedido/concreto/volumen del original',async()=>{
  const f=fixture();const data=form();
  const preview=await f.actions.extractProgrammingWorkbookAction({},data);
  assert.equal(preview.status,'success');assert.equal(preview.rows[0].errors.length,0);
  const saved=await f.actions.createProgrammingBatchAction({},data);
  assert.equal(saved.status,'success');assert.equal(f.extracts.length,2);
  assert.equal(f.extracts[0].file,f.extracts[1].file);
  assert.equal(f.extracts[1].project.id,projectId);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'create_programming_batch');
  const item=f.calls[0].args.p_items[0];
  assert.equal(item.scheduled_at,'2026-10-24T13:00:00.000Z');
  assert.equal(item.order_number,'106');assert.equal(item.lines[0].quantity,24);
  assert.equal(item.lines[0].concrete_type,'CONF4001');assert.equal(item.lines[0].unit_code,'M3');
  assert.deepEqual(Array.from(item.delivery_modes),['PUMP','PLACEMENT']);assert.ok(f.paths.includes('/programming'));
});
test('el servidor conserva validaciones de autorización, proyecto, Excel original y campos',async()=>{
  for(const options of [{permission:false},{activeProjectId:supplierId}]) {
    const f=fixture(options);for(const action of [f.actions.extractProgrammingWorkbookAction,f.actions.createProgrammingBatchAction]) assert.equal((await action({},form())).status,'error');
    assert.equal(f.extracts.length,0);assert.equal(f.calls.length,0);
  }
  for(const options of [{parserError:'Proyecto del archivo no coincide'},{m3:false},...[
    {scheduledAt:'2026-02-30T07:00'},{quantity:'0'},{orderNumber:''},{concreteType:''},
  ].map(patch=>({rows:[{...row,...patch}]}))]) {
    const f=fixture(options);assert.equal((await f.actions.createProgrammingBatchAction({},form())).status,'error');assert.equal(f.calls.length,0);
  }
  for(const patch of [{supplierId:''},{sourceRow:99}]) {
    const f=fixture();assert.equal((await f.actions.createProgrammingBatchAction({},form(patch))).status,'error');assert.equal(f.calls.length,0);
  }
  const f=fixture({rpcError:{message:'PROGRAMMING_BATCH_SUPPLIER_INVALID:1'}});
  assert.equal((await f.actions.createProgrammingBatchAction({},form())).status,'error');assert.equal(f.paths.length,0);
});
