import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import {REPORT_TABLE_HEADER_ROW,setupReportSheet} from '../src/features/reports/workbook-header.ts';
import {reportDispatchProcessStatus} from '../src/features/reports/presentation.ts';

const root=new URL('../',import.meta.url);
const [querySource,routeSource,viewSource]=await Promise.all(['src/features/reports/queries.ts','src/app/(dashboard)/reports/export/route.ts','src/features/reports/components/guide-report.tsx'].map(f=>readFile(new URL(f,root),'utf8')));
function load(source,imports){const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;runInNewContext(compiled,{exports,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];},Date,Intl,Response});return exports;}
const projects=[{id:'project-a',name:'ADO',code:'ADO-PRO',companyName:'Empresa',timezone:'America/Guatemala',billingLegalName:'Cliente'}];
const base={project_id:'project-a',supplier_id:'supplier',programming_id:'program-a',status:'COMPLETED',result:'DISPATCHED',created_by:'registrar',created_at:'2026-10-27T13:00:00Z',order_number:'47',real_volume:7,real_unit_code:'M3',completed_by:'validator'};
function fixture({labelsMissing=false}={}){
 const calls=[];
 const tables={programming:[{id:'program-a',project_id:'project-a',supplier_id:'supplier',created_by:'program-creator',status:'CONFIRMED',scheduled_at:'2026-10-27T13:00:00Z',requested_quantity:7,confirmed_quantity:7,unit_code:'M3'}],dispatches:[{...base,id:'completed'},{...base,id:'open',status:'IN_EXECUTION'},{...base,id:'legacy',completed_by:null},{...base,id:'foreign',programming_id:'program-b',project_id:'project-b'}],suppliers:[{id:'supplier',name:'Mixto Listo'}]};
 const client={from(table){calls.push({table});const checks=[];const q={select(value){calls.push({table,select:value});return q;},in(key,values){checks.push(row=>values.includes(row[key]));return q;},eq(key,value){checks.push(row=>row[key]===value);return q;},gte(){return q;},lte(){return q;},order(){return q;},is(){return q;},then(resolve,reject){return Promise.resolve({data:(tables[table]??[]).filter(row=>checks.every(check=>check(row))),error:null}).then(resolve,reject);}};return q;},async rpc(name,args){calls.push({rpc:name,args});return {data:[{profile_id:'program-creator',display_label:'Creador de programación'},{profile_id:'registrar',display_label:'Registró Uno'},...(!labelsMissing?[{profile_id:'validator',display_label:'Validó Dos'}]:[]),{profile_id:'unrelated',display_label:'Otro proyecto'}],error:null};}};
 const {getGuideReport}=load(querySource,{'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>client},'@/lib/supabase/server':{createClient:async()=>client},'@/features/projects/queries':{},'@/features/projects/access-policy':{}});
 return {calls,report:()=>getGuideReport(projects,{dateFrom:'2026-10-01',dateTo:'2026-10-31'})};
}
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
 'exceljs':ExcelJS,'@/features/auth/queries':{},'@/features/projects/queries':{},'@/features/reports/export-utils':{},'@/features/reports/archive-queries':{},'@/features/reports/zip-archive':{},'@/features/reports/zip-response':{},'@/features/reports/filters':{},'@/features/reports/queries':{},'@/features/reports/workbook-header':{REPORT_TABLE_HEADER_ROW,setupReportSheet:(sheet,columns,header)=>setupReportSheet(sheet,Array.from(columns),header)},'@/lib/status-labels':{formatStatusLabel:value=>value??''},'@/lib/supabase/admin':{},'@/lib/supabase/server':{},
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
const {testDispatchBlock}=load(viewSource+'\nexport {DispatchBlock as testDispatchBlock};',{
 'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},'next/link':{},'@/components/feedback/empty-state':{},'@/components/motion/motion-page':{},'@/components/motion/motion-section':{},'@/components/ui/badge':{},'@/lib/status-labels':{formatStatusLabel:value=>value??''},'../filters':{},'../presentation':{reportDispatchProcessStatus},'./report-export-actions':{},'./report-results-pagination':{},'./project-scoped-report-link':{},
});
test('la casilla de Reportería muestra el validador con fondo verde y conserva Pendiente/No registrado',async()=>{
 const report=await fixture().report();
 for(const [id,label] of [['completed','Validó Dos'],['open','Pendiente'],['legacy','No registrado']]){
  const tree=testDispatchBlock({dispatch:report.rows.find(row=>row.dispatchId===id)});
  const cell=nodes(tree).find(node=>node.props?.className?.includes('bg-success-soft')&&text(node).startsWith('Validado por'));
  assert.ok(cell);assert.equal(text(cell),'Validado por'+label);
 }
});
