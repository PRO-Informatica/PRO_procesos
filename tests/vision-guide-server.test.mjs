import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as draftModel from '../src/features/vision-ocr/guide-draft.ts';
import * as imageModel from '../src/features/vision-ocr/vision-ocr.ts';
const source=await readFile('src/features/vision-ocr/capture-server.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',projectId='00000000-0000-4000-8000-000000000003',dispatchId='00000000-0000-4000-8000-000000000004';
function fixture({copyFails=false,alreadyUploaded=false,environment='DEV',wrongProject=false,permission=true,permissions=null,deferredOperation=false,visionResult=null}={}){
 const bytes=new Uint8Array([255,216,255,4]),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 const project={id:projectId,name:'Proyecto QA',code:'QA',address:'1 calle 3-45 zona 1 Guatemala',additionalAddresses:[]};
 const capture={id,project_id:projectId,dispatch_id:dispatchId,created_by:actor,status:'EXTRACTED',guide_id:null,original_path:'original',original_name:'qa.jpg',original_mime:'image/jpeg',original_size:bytes.length,original_sha256:sha,expires_at:'2099-01-01T00:00:00Z',evidence_attached_at:null};
 const calls={commits:0,inserts:0,finalizes:0,copies:0,removes:0,updates:[],adminCreated:0,extracts:0,buckets:[]};
 const query=(value)=>{const q={select(){return q},eq(){return q},is(){return q},order(){return q},maybeSingle:async()=>({data:value,error:null}),single:async()=>({data:value,error:null}),range:async()=>({data:value,error:null}),then(resolve){return Promise.resolve({data:value,error:null}).then(resolve)}};return q};
 const db={from(table){return query(table==='profiles'?{active:true}:table==='dispatches'?{id:dispatchId,project_id:projectId,status:'IN_EXECUTION',programming_id:'program',version:1}:table==='programming'?{unit_code:'M3'}:table==='document_versions'?{upload_status:alreadyUploaded?'UPLOADED':'PENDING',upload_expires_at:'2099-01-01T00:00:00Z'}:[])},auth:{getClaims:async()=>({data:{claims:{sub:actor}}})},rpc:async(name)=>{
  if(name==='commit_vision_ocr_guide'){calls.commits++;if(!capture.guide_id){calls.inserts++;capture.guide_id='saved-guide';capture.status='SAVED'}return{data:{guide_id:capture.guide_id,dispatch_version:2,upload:{documentId:'doc',versionId:'version',bucket:'documents',path:'photo'}},error:null}}
  if(name==='finalize_document_upload'){calls.finalizes++;return{data:'version',error:null}}
  throw Error('Unexpected RPC '+name);
 }};
 const admin={
  from(table){
   assert.equal(table,'guide_ocr_captures');
   return{select:()=>query(capture),update(patch){
    calls.updates.push(patch);Object.assign(capture,patch);const q=query([{id}]);
    return{...q,then(resolve){resolve({data:[{id}],error:null})}};
   }};
  },
  storage:{from:(bucket)=>{calls.buckets.push(bucket);return({
   copy:async()=>{calls.copies++;return{error:copyFails?{message:'copy failed'}:null}},
   download:async()=>copyFails?{error:{message:'missing'}}:{data:new Blob([bytes]),error:null},
   remove:async()=>{calls.removes++;return{error:null}},
  })}},
 };
 const exports={};class VisionError extends Error{}
 const imports={'server-only':{},'node:crypto':crypto,'@/features/projects/queries':{getProjectContext:async()=>({status:'ready',activeProject:project,permissions:permissions??(permission?['dispatch.modify','dispatch.view']:[])})},'@/lib/env':{SUPABASE_PROJECT_REFS:{DEV:'gholwtklihaphoevosyb',PROD:'jeyjblxfqqlypxiaznad'},getPublicEnvironment:()=>({appEnvironment:environment,projectRef:wrongProject?'other':environment==='PROD'?'jeyjblxfqqlypxiaznad':'gholwtklihaphoevosyb'})},'@/lib/supabase/admin':{createAdminClient:()=>{calls.adminCreated++;return admin}},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/http/same-origin':{hasValidSameOrigin:()=>true},'./guide-draft':draftModel,'./service':{VisionOcrError:VisionError,extractDocumentText:async()=>{calls.extracts++;if(visionResult)return visionResult;if(deferredOperation)return{text:'PEDIDO / CONTROL OPERACIÓN',guideDraft:null};throw Error('Unexpected Google call')}},'./vision-ocr':imageModel};
 runInNewContext(compiled,{exports,Blob,File,AbortSignal,Date,console,Uint8Array,require(name){assert.ok(name in imports,name);return imports[name]}});
 return{server:exports,capture,calls,context:{db,admin,actor,project,dispatch:{id:dispatchId,status:'IN_EXECUTION'},unit:'M3',bucket:environment==='PROD'?'vision-ocr-prod':'vision-ocr-dev'},draft:{resident:{castingElement:'PILES',laboratoryApplied:true},guideNumber:'QA-1',arrivalTime:'23:22',departureTime:'03:20',details:{...draftModel.emptyGuideDetails(),projectName:project.name,workAddress:project.address,guideDate:'2026-10-29',orderNumber:'999'},lines:[{quantity:'1',unit:'UN',type:'SERVICE',productCode:'UNKNOWN',description:'Sin catálogo',catalogItemId:'',unitPrice:999}]}};
}
test('el servidor rechaza una mezcla de ambiente y proyecto antes de crear un cliente privilegiado',async()=>{
 const f=fixture({environment:'PROD',wrongProject:true});await assert.rejects(f.server.captureContext(new Request('http://localhost'),projectId,dispatchId),/Ambiente/);assert.equal(f.calls.adminCreated,0);assert.equal(f.calls.inserts,0);
});
test('PROD conserva permisos y usa exclusivamente su bucket de captura',async()=>{
 const f=fixture({environment:'PROD'});const context=await f.server.captureContext(new Request('http://localhost'),projectId,dispatchId);
 assert.equal(context.bucket,'vision-ocr-prod');await f.server.saveCapture(context,id,f.draft,1);
 assert.ok(f.calls.buckets.length>0);assert.ok(f.calls.buckets.every(bucket=>bucket==='vision-ocr-prod'));
});
test('capturar requiere permiso en el proyecto activo',async()=>{
 const f=fixture({permission:false});await assert.rejects(f.server.captureContext(new Request('http://localhost'),projectId,dispatchId),/permiso/);assert.equal(f.calls.adminCreated,0);
});
test('guardado deja pedido informativo, elimina precios enviados por cliente y adjunta foto original',async()=>{
 const f=fixture();const result=await f.server.saveCapture(f.context,id,f.draft,1);
 assert.equal(result.guideId,'saved-guide');assert.equal(f.calls.finalizes,1);assert.equal(f.calls.removes,1);
 const payload=f.calls.updates.find(x=>x.review_payload).review_payload;
 assert.equal(payload.details.orderNumber,'999');assert.equal(payload.lines[0].product_code,'UNKNOWN');assert.ok(!('unitPrice'in payload.lines[0]));assert.ok(!('unit_price'in payload.lines[0]));assert.equal(payload.lines[0].catalog_item_id,null);
});
test('una incidencia de catálogo desactivada informa la causa y no reporta guardado exitoso',async()=>{
 const f=fixture();
 f.context.db.rpc=async()=>({data:null,error:{message:'GUIDE_CATALOG_INCIDENT_TYPE_INACTIVE'}});
 await assert.rejects(f.server.saveCapture(f.context,id,f.draft,1),/tipo de incidencia.*inactivo/);
 assert.equal(f.calls.inserts,0);assert.equal(f.calls.copies,0);
});
test('proyecto, dirección y pedido leídos son informativos: conserva distintos y vacíos sin bloquear',async()=>{
 for(const change of [{projectName:'Otro proyecto'},{workAddress:'1 calle 3-46 zona 1 Guatemala'},{projectName:'',workAddress:'',orderNumber:''}]){
  const f=fixture();await f.server.saveCapture(f.context,id,{...f.draft,details:{...f.draft.details,...change}},1);
  assert.equal(f.calls.inserts,1);
  const payload=f.calls.updates.find(x=>x.review_payload).review_payload;
  for(const[key,value]of Object.entries(change))assert.equal(payload.details[key],value);
  assert.equal(payload.identity_checks.length,0);assert.ok(!('identity'in payload));
 }
});
test('un fallo al adjuntar informa que la guía ya existe y el reintento conserva el mismo registro',async()=>{
 const f=fixture({copyFails:true});await assert.rejects(f.server.saveCapture(f.context,id,f.draft,1),error=>{assert.equal(error.guideId,'saved-guide');return /no se creará otra guía/.test(error.message)});
 assert.equal(f.calls.inserts,1);assert.equal(f.calls.finalizes,0);
 // Replay reaching the RPC is idempotent even after the dispatch version changed.
 await assert.rejects(f.server.saveCapture(f.context,id,f.draft,1),/no se creará otra guía/);assert.equal(f.calls.commits,2);assert.equal(f.calls.inserts,1);
});
test('recupera la foto finalizada antes de perder la respuesta sin volver a finalizarla',async()=>{
 const f=fixture({alreadyUploaded:true});f.capture.guide_id='saved-guide';f.capture.status='SAVED';
 const result=await f.server.saveCapture(f.context,id,null,1);assert.equal(result.guideId,'saved-guide');assert.equal(f.calls.inserts,0);assert.equal(f.calls.finalizes,0);assert.equal(f.calls.copies,0);assert.ok(f.capture.evidence_attached_at);
});
test('alternativa manual guarda procedencia manual y no consume OCR',async()=>{
 const f=fixture();f.capture.status='PREPARED';
 const result=await f.server.extractCapture(f.context,id,new File([new Uint8Array([255,216,255,4])],'qa.jpg',{type:'image/jpeg'}),{},true);
 assert.equal(f.calls.extracts,0);assert.equal(result.draft.guideNumber,'');assert.ok(f.calls.updates.some(x=>x.image_adjustments?.source==='PHOTO_MANUAL'));
});
test('controles extraídos devuelven alternativas de la misma lectura sin guardar aún guías',async()=>{
 const f=fixture();f.capture.status='PREPARED';
 const control={...f.draft,resident:undefined,arrivalTime:'',departureTime:'',details:{...draftModel.emptyGuideDetails(),documentType:'MIXTO_OPERATION',orderNumber:'88'},lines:[{quantity:'14',unit:'M3',type:'SERVICE',productCode:'',description:'',catalogItemId:'',candidates:[],warning:null}]};
 const g=fixture({visionResult:{text:'PEDIDO CONTROL OPERACION',guideDraft:control,guideVariants:{MIXTO_OPERATION:control,PANEXUS_OPERATION:{...control,details:{...control.details,documentType:'PANEXUS_OPERATION'}},DISPATCH_GUIDE:control},imageRotation:3}});g.capture.status='PREPARED';
 const result=await g.server.extractCapture(g.context,id,new File([new Uint8Array([255,216,255,4])],'operacion.jpg',{type:'image/jpeg'}),{});
 assert.equal(result.draft.details.documentType,'MIXTO_OPERATION');assert.equal(result.draft.lines[0].quantity,'14');assert.equal(result.draft.arrivalTime,'');
 assert.equal(result.variants.PANEXUS_OPERATION.details.documentType,'PANEXUS_OPERATION');assert.equal(g.calls.extracts,1);assert.equal(g.calls.commits,0);assert.equal(g.capture.status,'EXTRACTED');
 const cached=await g.server.extractCapture(g.context,id,new File(['unused'],'qa.jpg',{type:'image/jpeg'}),{});
 assert.equal(cached.variants.PANEXUS_OPERATION.details.documentType,'PANEXUS_OPERATION');assert.equal(g.calls.extracts,1);
});
test('reintentar una lectura conserva orientación sin repetir OCR ni transformar la evidencia original',async()=>{
 const f=fixture();f.capture.extraction={...f.draft,catalogDraft:f.draft,imageRotation:3};
 const result=await f.server.extractCapture(f.context,id,new File(['unused'],'qa.jpg',{type:'image/jpeg'}),{});
 assert.equal(result.imageRotation,3);assert.equal(result.draft.guideNumber,'QA-1');assert.equal(f.calls.extracts,0);assert.equal(f.calls.updates.length,0);assert.equal(f.calls.copies,0);
});

test('lectura conserva el giro detectado y su reintento usa la misma extracción',async()=>{
 const input=fixture().draft;
 const f=fixture({visionResult:{text:'Texto Google QA',guideDraft:input,imageRotation:3}});f.capture.status='PREPARED';
 const image=new File([new Uint8Array([255,216,255,4])],'qa.jpg',{type:'image/jpeg'});
 const result=await f.server.extractCapture(f.context,id,image,{cropMode:'automatic',enhance:false});
 assert.equal(result.imageRotation,3);assert.equal(f.capture.extraction.imageRotation,3);assert.equal(f.capture.raw_text,'Texto Google QA');
 assert.equal(f.capture.image_adjustments.settings.cropMode,'automatic');assert.equal(f.calls.extracts,1);
 assert.equal((await f.server.extractCapture(f.context,id,image,{})).imageRotation,3);assert.equal(f.calls.extracts,1);
});

test('guarda selección del residente y UM vacía sin coerción; rechaza omitir la selección',async()=>{
 const f=fixture();f.draft.lines[0].unit='';await f.server.saveCapture(f.context,id,f.draft,1);
 const p=f.calls.updates.find(x=>x.review_payload).review_payload;
 assert.equal(p.casting_element,'PILES');assert.equal(p.laboratory_applied,true);assert.equal(p.lines[0].unit_code,'');
 const missing=fixture();delete missing.draft.resident;
 await assert.rejects(missing.server.saveCapture(missing.context,id,missing.draft,1),/elemento a fundir/);assert.equal(missing.calls.commits,0);
});

test('Supervisor puede guardar OCR y su evidencia con permiso de guías, sin modificar el despacho',async()=>{
 const f=fixture({permissions:['dispatch.manage_guides','dispatch.view']});
 const context=await f.server.captureContext(new Request('http://localhost'),projectId,dispatchId);
 const result=await f.server.saveCapture(context,id,f.draft,1);
 assert.equal(result.guideId,'saved-guide');assert.equal(f.calls.commits,1);assert.equal(f.calls.finalizes,1);
});
