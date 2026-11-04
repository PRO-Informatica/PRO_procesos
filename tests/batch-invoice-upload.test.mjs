import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as pairing from '../src/features/batches/invoice-upload-pairing.ts';
import * as parser from '../src/features/batches/mixto-listo-parser.ts';
import * as identity from '../src/features/invoices/dispatch-invoice-identity.ts';
import * as classification from '../src/features/invoices/invoice-classification.ts';
import * as fiscal from '../src/features/invoices/invoice-identity.ts';
import * as recipient from '../src/features/invoices/invoice-recipient-policy.ts';
import * as business from '../src/lib/business-identity.ts';
import * as address from '../src/lib/address-identity.ts';
import * as quantity from '../src/features/invoices/reconciliation-quantity.ts';
import * as reinvoicing from '../src/features/invoices/reinvoicing.ts';
import * as period from '../src/features/batches/period-policy.ts';

const compile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const actionsCode=await compile('../src/features/batches/actions.ts');
const processorCode=await compile('../src/features/invoices/invoice-processing.ts');
const queriesCode=await compile('../src/features/invoices/dispatch-invoice-identity-queries.ts');
function load(code,imports){const exports={};runInNewContext(code,{exports,File,FormData,Intl,Date,Buffer,crypto,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});return exports;}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=id(1),batch=id(2),dispatch121=id(3),dispatch137=id(4),supplier=id(7);
const productLine={quantity:8,unit_code:'M3',code:'86131064',description:'CONF4001 FLUIDO 4000 PSI'};
function raw(order,type,changes={}){return{invoice_number:`${type==='PRODUCT'?'1':'2'}${order}`,invoice_date:'2026-10-31',currency:'GTQ',subtotal:100,total:100,pca_original:`PCA-${order==='121'?'29102026':'30102026'}-0${order}`,lines:[type==='PRODUCT'?productLine:{quantity:8,unit_code:'M3',code:'SERV0250',description:'BOMBA + OPERADOR'}],detected_invoice_numbers:['one'],supplier_legal_name:'MEZCLADORA, S.A.',supplier_tax_id:'32709-3',billing_legal_name:'PROYECTO QA, S.A.',billing_tax_id:'1234567',shipping_address:'CALLE 1 ZONA 1 GUATEMALA',authorization_number:`AUTH-${order}-${type}`,series:'QA',...changes};}
function upload(order,type,changes={}){return{key:`${order}-${type}`,saved:false,inspection:null,file:new File([JSON.stringify(raw(order,type,changes))],`${order}-${type}.pdf`,{type:'application/pdf'})};}
export function fixture({permitted=true,extractPdf}={}){
 const reads=[],writes=[],validations=[];
 const tables={
  projects:[{id:project,company_id:id(8),address:'CALLE 1 ZONA 1 GUATEMALA',additional_addresses:[],billing_legal_name:'PROYECTO QA, S.A.',billing_tax_id:'1234567',timezone:'America/Guatemala'}],companies:[{id:id(8),code:'PRO-QA'}],
  batches:[{id:batch,project_id:project,accounting_period:'2026-10-01'}],suppliers:[{id:supplier,name:'MEZCLADORA, S.A.',tax_id:'32709-3'}],
  dispatches:[dispatch121,dispatch137].map((d,i)=>({id:d,project_id:project,programming_id:id(5+i),supplier_id:supplier,order_number:i?'137':'121',real_volume:8,real_unit_code:'M3',status:'COMPLETED',result:'DISPATCHED'})),
  programming:[5,6].map(n=>({id:id(n),project_id:project,requested_quantity:8,confirmed_quantity:8,unit_code:'M3'})),
  batch_dispatches:[dispatch121,dispatch137].map((d,i)=>({id:id(10+i),project_id:project,batch_id:batch,dispatch_id:d,removed_at:null})),
  dispatch_reconciliations:[dispatch121,dispatch137].map(d=>({dispatch_id:d,project_id:project,status:'NOT_STARTED',service_status:'NOT_STARTED',current_product_invoice_id:null,current_service_invoice_id:null})),
  project_product_prices:[{id:'price',project_id:project,code:'86131064',reference:'CONF4001'}],
  dispatch_guides:[dispatch121,dispatch137].map((d,i)=>({id:id(20+i),project_id:project,dispatch_id:d})),
  dispatch_guide_lines:[20,21].map(n=>({id:id(30+n),guide_id:id(n),project_id:project,catalog_type:'PRODUCT',product_code:'86131064',catalog_reference:'CONF4001'})),
  programming_lines:[5,6].map(n=>({id:id(40+n),programming_id:id(n),concrete_type:'CONF4001'})),
  dispatch_incidents:[],invoices:[],invoice_lines:[],
 };
 const client={from(table){const filters=[];reads.push({table,filters});let single=false,range=null;
  const query={select(){return query;},eq(k,v){filters.push(r=>r[k]===v);return query;},in(k,v){filters.push(r=>v.includes(r[k]));return query;},is(k,v){filters.push(r=>r[k]===v);return query;},order(){return query;},range(from,to){range=[from,to];return query;},maybeSingle(){single=true;return query;},then(resolve,reject){let data=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));const count=data.length;if(range)data=data.slice(range[0],range[1]+1);return Promise.resolve({data:single?data[0]??null:data,count,error:null}).then(resolve,reject);}};return query;},rpc(name){writes.push(name);throw Error('Unexpected write');}};
 const extractor={extractMixtoListoInvoicePdf:extractPdf??(async buffer=>JSON.parse(new TextDecoder().decode(buffer)))};
 const processor=load(processorCode,{'server-only':{},'@/features/batches/mixto-listo-extractor':extractor,'@/features/batches/mixto-listo-parser':parser,'@/lib/business-identity':business,'@/lib/address-identity':address,'./invoice-classification':classification,'./dispatch-invoice-identity':identity,'./invoice-identity':fiscal,'./invoice-recipient-policy':recipient,'@/features/batches/period-policy':period});
 const queries=load(queriesCode,{'server-only':{},'./dispatch-invoice-identity':identity});
 const trackedProcessor={...processor,processExtractedInvoice(raw,context){validations.push({type:context.expectedType,order:context.orderNumber,companionValid:context.productInvoiceIdentityValid});return processor.processExtractedInvoice(raw,context);}};
 const actions=load(actionsCode,{'next/cache':{revalidatePath(){throw Error('Preview must not revalidate');}},'@/features/auth/queries':{requireActiveProfile:async()=>({id:'user'})},'@/features/projects/queries':{getOperationalProjectAccessForProject:async()=>({permissions:permitted?['invoice.create']:[]})},'@/features/invoices/invoice-classification':classification,'@/features/invoices/dispatch-invoice-identity-queries':queries,'@/features/invoices/dispatch-invoice-identity':identity,'@/features/invoices/invoice-processing':trackedProcessor,'@/features/invoices/reconciliation-quantity':quantity,'@/features/invoices/reinvoicing':reinvoicing,'@/features/invoices/recipient-exception-service':{},'@/lib/address-identity':address,'@/lib/supabase/admin':{createAdminClient:()=>client},'@/lib/supabase/server':{createClient:async()=>client},'./mixto-listo-extractor':extractor,'./period-policy':period,'./mixto-listo-parser':parser,'./invoice-upload-pairing':pairing});
 const inspect=(u,{identifyOnly=false,product=null}={})=>{const form=new FormData();form.set('file',u.file);if(identifyOnly)form.set('identifyOnly','true');if(product)form.set('productFile',product.file);return actions.inspectBatchInvoicePdf(project,batch,form);};
 return{actions,inspect,tables,reads,writes,validations};
}

test('cuatro PDFs en cualquier orden se vinculan por despacho y PCA sin escribir',async()=>{
 for(const rows of[[upload('121','PRODUCT'),upload('121','SERVICE'),upload('137','PRODUCT'),upload('137','SERVICE')],[upload('137','SERVICE'),upload('121','SERVICE'),upload('121','PRODUCT'),upload('137','PRODUCT')]]){
  const f=fixture();const result=await pairing.inspectBatchInvoiceUploads(rows,f.inspect);
  assert.deepEqual(result.map(r=>r.key),rows.map(r=>r.key));
  assert.ok(result.every(r=>r.inspection.status==='READY'),JSON.stringify(result.map(r=>r.inspection)));
  for(const row of result)assert.equal(row.inspection.dispatchId,row.key.startsWith('121')?dispatch121:dispatch137);
  const firstService=f.validations.findIndex(v=>v.type==='SERVICE');
  assert.ok(firstService>=2);assert.ok(f.validations.slice(0,2).every(v=>v.type==='PRODUCT'));
  assert.deepEqual(f.writes,[]);assert.equal(f.tables.invoices.length,0);
 }
});

test('conserva la separación si se repite el pedido con un PCA distinto',async()=>{
 const f=fixture();const result=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE',{pca_original:'PCA-30102026-0121'}),upload('121','PRODUCT')],f.inspect);
 assert.equal(result[1].inspection.status,'READY');assert.equal(result[0].inspection.status,'ERROR');assert.match(result[0].inspection.message,/mismo PCA completo/u);assert.deepEqual(f.writes,[]);
});

test('un Producto con concreto incorrecto no habilita el Servicio',async()=>{
 const f=fixture();const result=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE'),upload('121','PRODUCT',{lines:[{...productLine,code:'86131066',description:'CONF5001'}]})],f.inspect);
 assert.equal(result[1].inspection.status,'ERROR');assert.match(result[1].inspection.message,/concreto/u);assert.equal(result[0].inspection.status,'ERROR');assert.deepEqual(f.writes,[]);
});

test('el servidor revalida el PDF compañero aunque se envíe directamente sin clasificación',async()=>{
 for(const changes of[{lines:[{...productLine,code:'OTHER'}]},{shipping_address:'OTRA DIRECCION'},{supplier_tax_id:'999999'},{pca_original:'PCA-29102026-0137'}]){
  const f=fixture();const result=await f.inspect(upload('121','SERVICE'),{product:upload('121','PRODUCT',changes)});
  assert.equal(result.status,'ERROR');assert.match(result.message,/Producto validado/u);assert.deepEqual(f.writes,[]);
 }
 const f=fixture();const result=await f.inspect(upload('121','SERVICE'),{product:upload('121','SERVICE')});assert.equal(result.status,'ERROR');
});

test('no elige un Producto arbitrario si existen dos candidatos en la carga',async()=>{
 const f=fixture();const result=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE'),upload('121','PRODUCT'),upload('121','PRODUCT',{invoice_number:'other'})],f.inspect);
 assert.equal(result[0].inspection.status,'ERROR');assert.ok(result.slice(1).every(r=>r.inspection.status==='READY'));
});

test('un Producto ya guardado con el mismo PCA permite cargar solo Servicio',async()=>{
 const f=fixture();f.tables.dispatch_reconciliations[0].current_product_invoice_id='stored';
 f.tables.invoices.push({id:'stored',project_id:project,dispatch_id:dispatch121,invoice_type:'PRODUCT',pca_original:'PCA-29102026-0121',status:'REGISTERED'});
 f.tables.invoice_lines.push({id:'line',invoice_id:'stored',...productLine});
 const result=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE')],f.inspect);
 assert.equal(result[0].inspection.status,'READY');assert.deepEqual(f.writes,[]);
});

test('un Producto duplicado o de otro despacho no sirve como compañero',async()=>{
 const f=fixture();f.tables.dispatch_reconciliations[0].current_product_invoice_id='occupied';
 f.tables.invoices.push({id:'occupied',project_id:project,dispatch_id:dispatch121,invoice_type:'PRODUCT',pca_original:'PCA-28102026-0121',status:'REGISTERED'});
 f.tables.invoice_lines.push({id:'line',invoice_id:'occupied',...productLine});
 const result=await f.inspect(upload('121','SERVICE'),{product:upload('121','PRODUCT')});assert.equal(result.status,'ERROR');
 const other=fixture();const separate=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE'),upload('137','PRODUCT')],other.inspect);assert.equal(separate[0].inspection.status,'ERROR');
});

test('la autorización y los PDFs inválidos se rechazan antes de consultar datos',async()=>{
 const f=fixture({permitted:false});assert.equal((await f.inspect(upload('121','PRODUCT'))).status,'ERROR');assert.equal(f.reads.length,0);
 const valid=fixture();const result=await valid.inspect({...upload('121','SERVICE'),file:new File(['bad'],'bad.pdf',{type:'text/plain'})});assert.equal(result.status,'ERROR');assert.equal(valid.reads.length,0);
 const companion=await valid.inspect(upload('121','SERVICE'),{product:{file:new File(['bad'],'bad.pdf',{type:'text/plain'})}});assert.equal(companion.status,'ERROR');assert.match(companion.message,/adjunto no es válido/u);
});

test('el guardado no confía en el compañero ni en un PCA/estado enviado por el navegador',async()=>{
 const f=fixture();const data=new FormData();data.set('file',upload('121','SERVICE').file);data.set('productFile',upload('121','PRODUCT').file);data.set('productInvoiceIdentityValid','true');data.set('productInvoicePca','PCA-29102026-0121');
 const result=await f.actions.saveDispatchInvoice(project,batch,dispatch121,'SERVICE',null,data);
 assert.equal(result.status,'error');assert.match(result.message,/Producto validado/u);assert.deepEqual(f.writes,[]);
});

test('guarda Productos antes de Servicios sin reordenar las tarjetas ni reprocesar guardadas',async()=>{
 const f=fixture();const rows=[upload('137','SERVICE'),upload('121','SERVICE'),upload('121','PRODUCT'),upload('137','PRODUCT')];
 const next=await pairing.inspectBatchInvoiceUploads(rows,f.inspect);assert.deepEqual(pairing.batchInvoiceSaveOrder(next),[2,3,0,1]);
 const original=[...next];let calls=0;const allSaved=next.map(r=>({...r,saved:true}));const result=await pairing.inspectBatchInvoiceUploads(allSaved,async()=>{calls+=1;throw Error('must not inspect');});
 assert.equal(calls,0);assert.deepEqual(result,allSaved);assert.deepEqual(next,original);
});

test('una diferencia de cantidad en Producto se conserva como alerta y permite vincular Servicio',async()=>{
 const f=fixture();const result=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE'),upload('121','PRODUCT',{lines:[{...productLine,quantity:7}]})],f.inspect);
 assert.equal(result[1].inspection.status,'WITH_DIFFERENCES');assert.equal(result[1].inspection.payload.difference,-1);assert.equal(result[0].inspection.status,'READY');assert.deepEqual(f.writes,[]);
});

test('una refacturación autorizada puede usarse como compañero sin aceptar una factura ocupada',async()=>{
 const f=fixture();Object.assign(f.tables.dispatch_reconciliations[0],{status:'PENDING_REINVOICING',current_product_invoice_id:'old'});
 f.tables.invoices.push({id:'old',project_id:project,dispatch_id:dispatch121,invoice_type:'PRODUCT',invoice_number:'previous',pca_original:'PCA-28102026-0121',status:'REGISTERED'});
 f.tables.invoice_lines.push({id:'line',invoice_id:'old',...productLine});
 const result=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE'),upload('121','PRODUCT')],f.inspect);
 assert.equal(result[1].inspection.operation,'REINVOICE');assert.equal(result[1].inspection.replacesInvoiceId,'old');assert.equal(result[0].inspection.status,'READY');assert.deepEqual(f.writes,[]);
});

const dialogCode=ts.transpileModule(await readFile(new URL('../src/features/batches/components/invoice-dialogs.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const nodeText=node=>node==null?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(nodeText).join(''):nodeText(node.props?.children);
async function saveThroughDialog(rows,{failProduct=false}={}){
 let hook=0,pending,updated;const calls=[];
 const imports={react:{useMemo:fn=>fn(),useState:initial=>{const index=hook++;return[index===0?rows:initial,value=>{if(index===0)updated=value;}];},useTransition:()=>[false,fn=>{pending=fn();}]},'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh(){}})},'lucide-react':{},'../actions':{async saveDispatchInvoice(_project,_batch,dispatch,type){calls.push(`${dispatch}:${type}`);return failProduct&&dispatch===dispatch121&&type==='PRODUCT'?{status:'error',message:'Falló Producto'}:{status:'success'};},async reconcileDispatchAction(){return{status:'success'};}},'../formatters':{formatBatchQuantity:String},'../invoice-upload-pairing':pairing,'./batch-dialogs':{Modal:'Modal'},'@/components/feedback/loading-button':{LoadingButton:'LoadingButton'},'@/components/ui/button':{Button:'Button'},'@/components/ui/dialog':{DialogFooter:'DialogFooter'},'@/components/ui/icon-button':{IconButton:'IconButton'},'@/lib/notification-messages':{notifications:{}},'@/lib/notify':{notify:{success(){},warning(){},error(){}}}};
 const api=load(dialogCode,imports);
 const tree=api.BulkInvoiceDialog({projectId:project,batchId:batch,onClose(){}});
 const button=nodes(tree).find(node=>node.props?.onClick&&nodeText(node.props.children).startsWith('Conciliar ('));
 assert.ok(button);button.props.onClick();await pending;
 return{calls,rows:updated};
}

test('el botón Conciliar guarda primero Productos aunque Servicio esté al principio',async()=>{
 const f=fixture();const rows=await pairing.inspectBatchInvoiceUploads([upload('137','SERVICE'),upload('121','SERVICE'),upload('121','PRODUCT'),upload('137','PRODUCT')],f.inspect);
 const result=await saveThroughDialog(rows);
 assert.deepEqual(result.calls,[`${dispatch121}:PRODUCT`,`${dispatch137}:PRODUCT`,`${dispatch137}:SERVICE`,`${dispatch121}:SERVICE`]);assert.ok(result.rows.every(row=>row.saved));
});

test('si falla un Producto, Conciliar conserva el error y no guarda su Servicio',async()=>{
 const f=fixture();const rows=await pairing.inspectBatchInvoiceUploads([upload('121','SERVICE'),upload('137','SERVICE'),upload('121','PRODUCT'),upload('137','PRODUCT')],f.inspect);
 const result=await saveThroughDialog(rows,{failProduct:true});
 assert.deepEqual(result.calls,[`${dispatch121}:PRODUCT`,`${dispatch137}:PRODUCT`,`${dispatch137}:SERVICE`]);
 assert.equal(result.rows[0].saved,false);assert.match(result.rows[0].saveError,/No se guardó el Producto/u);assert.match(result.rows[2].saveError,/Falló Producto/u);assert.equal(result.rows[1].saved,true);assert.equal(result.rows[3].saved,true);
});
