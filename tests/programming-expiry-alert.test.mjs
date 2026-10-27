import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as availability from '../src/features/programming/availability.ts';

const source=await readFile(new URL('../src/features/programming/components/programming-detail-view.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const expired={status:'CONFIRMED',scheduledAt:'2000-01-01T13:00:00Z',operationStarted:false,hasPermission:true};
test('Vencido conserva la alerta y permite iniciar el despacho sin cambiar la fecha',()=>{
  assert.equal(availability.getEffectiveProgrammingStatus(expired),'EXPIRED');
  assert.equal(availability.canCreateDispatchForProgramming(expired),true);
  assert.equal(availability.canCreateDispatchForProgramming({...expired,scheduledAt:'2026-10-27T13:00:00Z'},new Date('2026-10-27T13:05:00Z').valueOf()),true);
  for(const patch of [{hasPermission:false},{status:'PENDING_CONFIRMATION'},{status:'CANCELLED'},{status:'COMPLETED'},{status:'DRAFT'}]) assert.equal(availability.canCreateDispatchForProgramming({...expired,...patch}),false);
});

function nodes(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(nodes);return[node,...nodes(node.props?.children)];}
function content(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(content).join('');return content(node.props?.children);}
function fixture(patch={},permissionsPatch={}){
 const detail={...expired,id:'00000000-0000-4000-8000-000000000001',version:2,projectId:'project',supplierId:'supplier',supplierName:'Mixto Listo',orderNumber:'136',requestedQuantity:6.5,confirmedQuantity:6.5,unitCode:'M3',deliveryModes:['PUMP'],lines:[],dispatches:[],revisions:[],createdAt:expired.scheduledAt,updatedAt:expired.scheduledAt,createdByName:'Compras',notes:null,...patch};
 const permissions={canCreateDispatch:true,canModify:true,canConfirm:true,canCancel:true,canClose:true,...permissionsPatch};
 let index=0,tree;const state=[];const jsx=(type,props)=>({type,props});
 const imports={
  'react/jsx-runtime':{jsx,jsxs:jsx},react:{useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useMemo:fn=>fn(),useEffect(){},useActionState:()=>[{status:'idle'},()=>{},false]},
  'lucide-react':{},'motion/react':{AnimatePresence:'AnimatePresence'},'next/link':{default:'Link'},'next/navigation':{useRouter:()=>({refresh(){}})},
  '@/components/feedback/loading-button':{LoadingButton:'LoadingButton'},'@/components/feedback/use-action-notification':{useActionNotification(){}},
  '@/components/ui/button':{Button:'Button'},'@/components/ui/dialog':{Dialog:'Dialog',DialogFooter:'DialogFooter'},
  '@/lib/notification-messages':{notifications:{}},'@/lib/status-labels':{formatStatusLabel:value=>value},
  '../actions':{},'../invoice-policy':{deliveryModeLabel:()=> 'Bomba',requiresServiceInvoice:()=>true},'../availability':availability,
  '../formatters':{formatProgrammingStatus:value=>value==='EXPIRED'?'Vencido':value,formatProgrammingDateTime:String,formatProgrammingQuantity:String,programmingStatusTone:()=>''},
  '../types':{},'./programming-edit-dialog':{ProgrammingEditDialog:'EditDialog'},'@/features/dispatches/components/register-dispatch-dialog':{StartDispatchDialog:'StartDispatchDialog'},
 };
 const exports={};runInNewContext(compiled,{exports,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];},Date,Intl});
 const render=()=>{index=0;tree=exports.ProgrammingDetailView({data:{detail,suppliers:[],units:[]},project:{id:'project',name:'QA',timezone:'America/Guatemala'},receiverName:'Residente',permissions});};
 render();return{render,all:()=>nodes(tree),button:label=>nodes(tree).find(n=>n.type==='button'&&content(n).trim()===label)};
}
test('el detalle vencido muestra aviso informativo y abre Iniciar despacho con la fecha original',()=>{
 const f=fixture();
 const alert=f.all().find(n=>n.props?.role==='status');
 assert.ok(alert);assert.match(content(alert),/Puedes iniciar el despacho y registrar sus guías/u);assert.doesNotMatch(content(alert),/ya no acepta/u);
 assert.ok(f.all().some(n=>content(n)==='Vencido'));
 assert.ok(f.button('Editar'));assert.ok(f.button('Cancelar'));
 const start=f.button('Registrar despacho');assert.ok(start);assert.notEqual(start.props.disabled,true);start.props.onClick();f.render();
 const dialog=f.all().find(n=>n.type==='StartDispatchDialog');assert.ok(dialog);
 assert.equal(dialog.props.programming.scheduledAt,expired.scheduledAt);assert.equal(dialog.props.programming.programmingStatus,'CONFIRMED');
 assert.equal(dialog.props.programming.orderNumber,'136');
});
test('la alerta no habilita operaciones sin permiso ni para programaciones pendientes, canceladas o completadas',()=>{
 for(const f of [fixture({}, {canCreateDispatch:false}),fixture({status:'PENDING_CONFIRMATION'}),fixture({status:'CANCELLED'}),fixture({status:'COMPLETED'})]) {
  assert.equal(f.button('Registrar despacho'),undefined);
  assert.equal(f.all().find(n=>n.type==='StartDispatchDialog'),undefined);
 }
});
