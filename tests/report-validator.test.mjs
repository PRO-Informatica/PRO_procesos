import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import {REPORT_TABLE_HEADER_ROW,setupReportSheet} from '../src/features/reports/workbook-header.ts';
import {guideReportMetadata} from '../src/features/reports/guide-metadata.ts';
import {serviceReconciliationSummary} from '../src/features/invoices/service-reconciliation.ts';
import {requiresServiceInvoice} from '../src/features/programming/invoice-policy.ts';
import {reportDispatchProcessStatus,reportStatusTone} from '../src/features/reports/presentation.ts';
import * as projectAccess from '../src/features/projects/access-policy.ts';
import {formatStatusLabel} from '../src/lib/status-labels.ts';

const root=new URL('../',import.meta.url);
const [querySource,routeSource,rowSource]=await Promise.all(['src/features/reports/queries.ts','src/app/(dashboard)/reports/export/route.ts','src/features/reports/components/report-table-rows.tsx'].map(f=>readFile(new URL(f,root),'utf8')));
function load(source,imports){const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;runInNewContext(compiled,{exports,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];},Date,Intl,Response});return exports;}
const projects=[{id:'project-a',name:'ADO',code:'ADO-PRO',companyName:'Empresa',timezone:'America/Guatemala',billingLegalName:'Cliente'}];
const base={project_id:'project-a',supplier_id:'supplier',programming_id:'program-a',status:'COMPLETED',result:'DISPATCHED',created_by:'registrar',created_at:'2026-10-27T13:00:00Z',order_number:'47',real_volume:7,real_unit_code:'M3',completed_by:'validator'};
function fixture({labelsMissing=false,billingComplete=false,supplierName="Mixto Listo",otherSupplier=false,reportProjects=projects,withoutDispatches=false,reconciliations=[],deliveryModes}={}){
 const calls=[];
 const tables={programming:[{id:'program-a',project_id:'project-a',supplier_id:'supplier',created_by:'program-creator',status:'CONFIRMED',scheduled_at:'2026-10-27T13:00:00Z',requested_quantity:7,confirmed_quantity:7,unit_code:'M3'}],dispatches:[{...base,id:'completed'},{...base,id:'open',status:'IN_EXECUTION'},{...base,id:'legacy',completed_by:null},{...base,id:'foreign',programming_id:'program-b',project_id:'project-b'}],suppliers:[{id:'supplier',name:supplierName}]};
 tables.programming[0].delivery_modes=deliveryModes;
 tables.dispatch_reconciliations=reconciliations;
 if(otherSupplier){tables.suppliers.push({id:'other',name:'Otro proveedor'});tables.programming.push({...tables.programming[0],id:'other-program',supplier_id:'other'});tables.dispatches.push({...base,id:'other-dispatch',programming_id:'other-program',supplier_id:'other'});}
 if(withoutDispatches)tables.dispatches=[];
 const client={from(table){calls.push({table});const checks=[];const q={select(value){calls.push({table,select:value});return q;},in(key,values){checks.push(row=>values.includes(row[key]));return q;},eq(key,value){checks.push(row=>row[key]===value);return q;},gte(){return q;},lte(){return q;},order(){return q;},is(){return q;},then(resolve,reject){return Promise.resolve({data:(tables[table]??[]).filter(row=>checks.every(check=>check(row))),error:null}).then(resolve,reject);}};return q;},async rpc(name,args){calls.push({rpc:name,args});return {data:[{profile_id:'program-creator',display_label:'Creador de programación'},{profile_id:'registrar',display_label:'Registró Uno'},...(!labelsMissing?[{profile_id:'validator',display_label:'Validó Dos'}]:[]),{profile_id:'unrelated',display_label:'Otro proyecto'}],error:null};}};
 const {getGuideReport}=load(querySource,{'server-only':{},'@/features/dispatches/billing-completion-queries':{getDispatchBillingCompletion:async(ids)=>{calls.push({billingProjects:Array.from(ids)});return {completed:billingComplete,legacy:false,open:false};}},'@/lib/supabase/admin':{createAdminClient:()=>client},'@/lib/supabase/server':{createClient:async()=>client},'@/features/projects/queries':{},'@/features/projects/access-policy':{},'@/features/invoices/service-reconciliation':{serviceReconciliationSummary},'@/features/programming/invoice-policy':{requiresServiceInvoice},'./guide-metadata':{guideReportMetadata}});
 return {calls,report:(filters={},settings={})=>getGuideReport(reportProjects,{dateFrom:'2026-10-01',dateTo:'2026-10-31',...filters},settings)};
}
test('el reporte consulta el cierre solo de proyectos con despachos visibles, sin incluir empresas vacías',async()=>{
 const f=fixture({reportProjects:[...projects,{...projects[0],id:'empty-project',companyName:'Otra empresa'}]});
 assert.equal((await f.report()).rows.length,3);
 assert.deepEqual(f.calls.find(call=>call.billingProjects).billingProjects,['project-a']);
});
test("el reporte conserva el estado y la diferencia de Servicio cuando Producto ya está conciliado", async () => {
  const reconciliations = [
    {
      dispatch_id: "completed", status: "RECONCILED", current_service_invoice_id: "service",
      service_status: "WITH_DIFFERENCES", service_comparison: { difference: "167.74", currency: "GTQ" },
    },
    { dispatch_id: "open", status: "NOT_STARTED", current_service_invoice_id: "pending-service", service_status: "NOT_STARTED" },
  ];
  const report = await fixture({ reconciliations, deliveryModes: ["PUMP", "PLACEMENT"] }).report();
  const completed = report.rows.find(({ dispatchId }) => dispatchId === "completed");
  assert.equal(completed.reconciliationStatus, "RECONCILED");
  assert.equal(completed.serviceReconciliation.status, "WITH_DIFFERENCES");
  assert.equal(completed.serviceReconciliation.difference, 167.74);
  assert.equal(completed.serviceReconciliation.currency, "GTQ");
  assert.equal(completed.billingComplete, false);
  assert.equal(report.rows.find(({ dispatchId }) => dispatchId === "open").serviceReconciliation.status, "PENDING_RECONCILIATION");

  const direct = await fixture({ deliveryModes: ["DIRECT"] }).report();
  assert.ok(direct.rows.every((row) => row.serviceReconciliation === null));
  const historical = await fixture().report();
  assert.ok(historical.rows.every((row) => row.serviceReconciliation.status === "NOT_STARTED"));
});
test('una programación sin despachos no solicita el cierre financiero de su proyecto',async()=>{
 const f=fixture({withoutDispatches:true});
 const report=await f.report();
 assert.equal(report.rows.length,0);
 assert.equal(report.programming.length,1);
 assert.deepEqual(f.calls.find(call=>call.billingProjects).billingProjects,[]);
});
test('Reportería usa completed_by, distinto al registrador, sin atribuir validación a despachos abiertos',async()=>{
 const f=fixture(),report=await f.report();
 assert.equal(report.rows.length,3);
 const completed=report.rows.find(row=>row.dispatchId==='completed');
 assert.equal(completed.registeredByName,'Registró Uno');assert.equal(completed.completedById,'validator');assert.equal(completed.completedByName,'Validó Dos');
 for(const id of ['open','legacy']){const row=report.rows.find(row=>row.dispatchId===id);assert.equal(row.completedById,null);assert.equal(row.completedByName,null);}
 assert.deepEqual(Array.from(report.filters.users,v=>v.value).sort(),['program-creator','registrar']);
 const call=f.calls.find(c=>c.rpc==='get_report_actor_labels');assert.deepEqual(Array.from(call.args.p_project_ids),['project-a']);
 assert.ok(f.calls.some(c=>c.table==='dispatches'&&c.select?.includes('completed_by')));assert.ok(!f.calls.some(c=>c.table==='profiles'));
});
test('una identidad no disponible no se sustituye por el nombre del registrador',async()=>{
 const report=await fixture({labelsMissing:true}).report();assert.equal(report.rows[0].completedByName,'Usuario no disponible');
});
const {testBuildWorkbook}=load(routeSource+'\nexport {buildWorkbook as testBuildWorkbook};',{
 '@/features/reports/presentation':{reportDispatchProcessStatus},'exceljs':ExcelJS,'@/features/auth/queries':{},'@/features/projects/queries':{},'@/features/projects/access-policy':projectAccess,'@/features/reports/export-utils':{},'@/features/reports/archive-queries':{},'@/features/reports/zip-archive':{},'@/features/reports/zip-response':{},'@/features/reports/filters':{},'@/features/reports/queries':{},'@/features/reports/workbook-header':{REPORT_TABLE_HEADER_ROW,setupReportSheet:(sheet,columns,header)=>setupReportSheet(sheet,Array.from(columns),header)},'@/lib/status-labels':{formatStatusLabel:value=>value??''},'@/lib/supabase/admin':{},'@/lib/supabase/server':{},
});
test('el Excel conserva la columna Validado por y su fondo verde al guardar y reabrir',async()=>{
 const report=await fixture().report();
 report.programming.push({...report.programming[0],id:'no-dispatch',dispatches:[]});
 const workbook=await testBuildWorkbook(report,'Empresa',{projectTitle:'ADO',billingLegalName:'Cliente',billingTaxId:'123',period:'Octubre 2026'});
 const sheet=workbook.getWorksheet('Reporte');const col=sheet.getColumn('dispatchValidatedBy').number;
 assert.equal(sheet.getCell(REPORT_TABLE_HEADER_ROW,col).value,'Validado por');
 const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
 const result=reopened.getWorksheet('Reporte');
 assert.equal(result.getCell(REPORT_TABLE_HEADER_ROW,col).fill.fgColor.argb,'FF15803D');
 assert.equal(result.getCell(REPORT_TABLE_HEADER_ROW,col).font.color.argb,'FFFFFFFF');
 assert.equal(result.getCell(REPORT_TABLE_HEADER_ROW+1,col).value,'Validó Dos');
 for(let row=REPORT_TABLE_HEADER_ROW+1;row<=REPORT_TABLE_HEADER_ROW+4;row++)assert.equal(result.getCell(row,col).fill.fgColor.argb,'FFDCFCE7');
 for(let row=REPORT_TABLE_HEADER_ROW+2;row<=REPORT_TABLE_HEADER_ROW+4;row++)assert.ok(!result.getCell(row,col).value);
 assert.equal(result.autoFilter,`A${REPORT_TABLE_HEADER_ROW}:${sheet.getColumn(sheet.columnCount).letter}${REPORT_TABLE_HEADER_ROW}`);
});
function nodes(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(nodes);return[node,...nodes(node.props?.children)];}
function text(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
const jsx=(type,props)=>({type,props});
const {DispatchTableRow}=load(rowSource,{
 'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{Eye:'Eye'},'@/components/ui/badge':{Badge:'Badge'},'@/lib/status-labels':{formatStatusLabel},
 '@/features/dispatches/components/dispatch-badges':{DispatchResultBadge:'DispatchResultBadge'},
 '@/features/dispatches/formatters':{formatDispatchDateTime:value=>value,formatDispatchQuantity:value=>value,formatDispatchMoney:value=>value},
 '../presentation':{reportDispatchProcessStatus,reportStatusTone},'./project-scoped-report-link':{ProjectScopedReportLink:'ProjectScopedReportLink'},'./report-results-table.module.css':{default:{}},
});
test('la fila muestra el validador y conserva Pendiente/No registrado',async()=>{
 const report=await fixture().report();
 for(const [id,label] of [['completed','Validó Dos'],['open','Pendiente'],['legacy','No registrado']]){
  const tree=DispatchTableRow({dispatch:report.rows.find(row=>row.dispatchId===id)});
  assert.equal(text(tree.props.children.at(-2)),label);
  const action=nodes(tree).find(node=>node.type==='ProjectScopedReportLink');
  assert.equal(action.props.href,`/dispatches/${id}`);
  assert.equal(text(action),`Ver despacho DSP-${id.toUpperCase().slice(0,8)}`);
  assert.ok(nodes(action).some(node=>node.type==='Eye'&&node.props['aria-hidden']));
 }
});

test('Reportería conserva Producto conciliado sin mostrar cierre global cuando Servicio sigue pendiente',async()=>{
 for(const complete of [false,true]){
  const report=await fixture({billingComplete:complete}).report(),row=report.rows.find(row=>row.dispatchId==='completed');
  assert.equal(row.billingComplete,complete);row.reconciliationStatus='RECONCILED';
  const tree=DispatchTableRow({dispatch:row});
  assert.equal(nodes(tree.props.children[3]).find(node=>node.props?.status)?.props.status,complete?'COMPLETED':'PENDING_RECONCILIATION');
  assert.equal(tree.props.children[4].props.children.props.status,'RECONCILED');
 }
});

test('un despacho pendiente de conciliación muestra únicamente la etiqueta azul de su estado', async () => {
  const report = await fixture({
    reconciliations: [{ dispatch_id: 'completed', status: 'NOT_STARTED', service_status: 'NOT_STARTED' }],
  }).report();
  const dispatch = report.rows.find(row => row.dispatchId === 'completed');
  for (const result of ['DISPATCHED', 'NOT_DISPATCHED', 'PENDING']) {
    const { props: { children } } = DispatchTableRow({ dispatch: { ...dispatch, physicalResult: result } });
    const stateCell = nodes(children[3]);
    const status = stateCell.find(node => node.props?.status === 'PENDING_RECONCILIATION');
    assert.ok(status);
    const badge = status.type(status.props);
    assert.equal(badge.props.tone, 'info');
    assert.equal(badge.props.children, 'Pendiente de conciliación');
    assert.equal(stateCell.some(node => node.type === 'DispatchResultBadge'), false);
    assert.equal(children[4].props.children.props.status, 'NOT_STARTED');
    assert.equal(children[5].props.children.props.status, 'NOT_STARTED');
  }
  const { props: { children } } = DispatchTableRow({ dispatch: { ...dispatch, dispatchStatus: 'IN_EXECUTION', physicalResult: 'PENDING' } });
  const stateCell = nodes(children[3]);
  assert.equal(stateCell.find(node => node.props?.status)?.props.status, 'IN_EXECUTION');
  assert.equal(stateCell.some(node => node.type === 'DispatchResultBadge'), false);
});

test('el Excel usa el cierre financiero y conserva Producto conciliado con Servicio pendiente',async()=>{
 const report=await fixture().report();report.rows[0].reconciliationStatus='RECONCILED';
 const workbook=await testBuildWorkbook(report,'Empresa',{projectTitle:'ADO',billingLegalName:'Cliente',billingTaxId:'123',period:'Octubre 2026'});
 const dispatchColumn=workbook.getWorksheet('Reporte').getColumn('dispatchStatus').number;
 const productColumn=workbook.getWorksheet('Reporte').getColumn('reconciliationStatus').number;
 const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
 const sheet=reopened.getWorksheet('Reporte');
 assert.equal(sheet.getCell(REPORT_TABLE_HEADER_ROW+1,dispatchColumn).value,'PENDING_RECONCILIATION');
 assert.equal(sheet.getCell(REPORT_TABLE_HEADER_ROW+1,productColumn).value,'RECONCILED');
});


test('la conciliación completa solo incluye despachos autorizados y elimina programaciones sin coincidencias',async()=>{
 const f=fixture({billingComplete:true});
 const complete=await f.report({billingStatus:'reconciled'});
 assert.deepEqual(Array.from(complete.rows,row=>row.dispatchId),['completed']);
 assert.equal(complete.programming[0].dispatches.length,1);
 const pending=await f.report({billingStatus:'pending'});
 assert.deepEqual(Array.from(pending.rows,row=>row.dispatchId).sort(),['legacy','open']);
 const none=await fixture().report({billingStatus:'reconciled'});
 assert.equal(none.rows.length,0);
 assert.equal(none.programming.length,0);
});


test('el reporte universal fija Mixto Listo aunque la URL envíe otro proveedor o estado de programación',async()=>{
 for(const supplierName of ['Mixto Listo','MEZCLADORA, S.A.']){
  const f=fixture({supplierName,otherSupplier:true});
  const report=await f.report({supplierId:'other',programmingStatus:'CANCELLED'},{mixtoListoOnly:true});
  assert.equal(report.rows.length,3);
  assert.ok(report.programming.every(row=>row.supplierName===supplierName));
  assert.ok(!report.rows.some(row=>row.dispatchId==='other-dispatch'));
  assert.deepEqual(Array.from(report.filters.projects,row=>row.label),['Empresa · ADO · ADO-PRO']);
 }
});
test('sin Mixto Listo o con proyecto ajeno el reporte universal no devuelve datos de otro proveedor',async()=>{
 const f=fixture({supplierName:'Otro proveedor'});
 assert.equal((await f.report({},{mixtoListoOnly:true})).programming.length,0);
 assert.ok(!f.calls.some(call=>call.table==='programming'));
 const foreign=fixture();
 assert.equal((await foreign.report({projectId:'project-b'},{mixtoListoOnly:true})).rows.length,0);
 assert.ok(!foreign.calls.some(call=>call.table==='programming'));
});
test('los reportes universales conservan proyectos históricos y excluyen Residente y Supervisor',async()=>{
 const scopes=[
  {project:{id:'company-a-active',status:'ACTIVE'},roleCodes:['PURCHASING'],permissions:['dispatch.view']},
  {project:{id:'company-b-history',status:'INACTIVE'},roleCodes:['COMPANY_ADMIN'],permissions:['dispatch.view']},
  {project:{id:'platform-history',status:'CLOSED'},roleCodes:['PLATFORM_ADMIN'],permissions:['dispatch.view']},
  {project:{id:'resident'},roleCodes:['RESIDENT'],permissions:['dispatch.view']},
  {project:{id:'supervisor'},roleCodes:['SUPERVISOR'],permissions:['dispatch.view']},
  {project:{id:'missing-permission'},roleCodes:['PURCHASING'],permissions:[]},
 ];
 const {getUniversalReportScopes}=load(querySource,{'server-only':{},'@/features/dispatches/billing-completion-queries':{},'@/lib/supabase/admin':{},'@/lib/supabase/server':{},'@/features/projects/queries':{getOperationalProjectAccess:async()=>scopes},'@/features/projects/access-policy':projectAccess,'@/features/invoices/service-reconciliation':{serviceReconciliationSummary},'@/features/programming/invoice-policy':{requiresServiceInvoice},'./guide-metadata':{guideReportMetadata}});
 assert.deepEqual(Array.from(await getUniversalReportScopes('user'),scope=>scope.project.id),['company-a-active','company-b-history','platform-history']);
});
