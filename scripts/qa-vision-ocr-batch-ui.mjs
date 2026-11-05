// Isolated hydrated-component checks. Fake API/catalog; never signs into PROD.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
if(!process.env.OCR_QA_PDF)throw Error('Set OCR_QA_PDF to a local four-page sample PDF. It is served only to the isolated local browser; APIs are mocked.');
const root=process.cwd();process.umask(0o077);await mkdir('tmp',{recursive:true});
const dir=await mkdtemp('tmp/vision-ocr-batch-ui-'),harness=await mkdtemp(path.join(tmpdir(),'pro-ocr-ui-'));
const product={id:'00000000-0000-4000-8000-000000000001',type:'PRODUCT',code:'86131064',reference:'CONF4001',description:null,observations:null,unitCode:null,price:1224.16,currency:'GTQ'};
const service={...product,id:'00000000-0000-4000-8000-000000000002',type:'SERVICE',code:'SERV1',reference:null,description:'Bomba',observations:'Variante para volumen menor a 6',unitCode:'UN',price:100};
const variant={...service,id:'00000000-0000-4000-8000-000000000003',observations:'Variante para volumen mayor a 6',price:200};
const details={customerName:'Cliente QA',projectName:'Proyecto QA',workAddress:'1 calle 3-45 zona 1 Guatemala',guideDate:'2026-10-29',orderNumber:'999',plant:'QU',truck:'0186',loadingTime:'18:00',pilot:'Piloto QA',operator:'0079',observations:'Observación manuscrita'};
const line={quantity:'1',unit:'UN',productCode:'SERV1',description:'Bomba',type:'SERVICE',catalogItemId:'',candidates:[service,variant],warning:'Selecciona la variante'};
const draft={guideNumber:'7145427',arrivalTime:'23:22',departureTime:'03:20',details,rawTimes:{loading:'6 pm',arrival:'23:22',departure:'03:20'},confidence:{projectName:.7},warnings:['Revisa el proyecto','Línea 1: confirma la UM «ma».'],lines:[{...line,quantity:'7',unit:'',productCode:product.code,description:product.reference,type:'PRODUCT',catalogItemId:product.id,candidates:[product],warning:null},{...line,productCode:'UNKNOWN',description:'Servicio no catalogado',candidates:[],warning:'Precio pendiente'},line,{...line,unit:'',catalogItemId:service.id,candidates:[service],warning:null},{...line,unit:'',catalogItemId:service.id,candidates:[service],warning:null}]};
const result={captureId:'00000000-0000-4000-8000-000000000010',draft,rawText:'Texto OCR de prueba',project:{name:'Proyecto activo DIFERENTE',code:'QA',address:'Otra dirección',additionalAddresses:[]}};
await writeFile(path.join(harness,'env.js'),`export const getPublicEnvironment=()=>({appEnvironment:'DEV'});`);
await writeFile(path.join(harness,'client.js'),`export const createClient=()=>({storage:{from:()=>({uploadToSignedUrl:async()=>{window.uploads=(window.uploads||0)+1;return{data:{},error:null};}})}});`);
await writeFile(path.join(harness,'actions.js'),`export async function searchDispatchCatalogAction(){return{status:'success',items:${JSON.stringify([product,service,variant])}}};export async function saveDispatchGuideAction(previous,data){window.manualSaves=(window.manualSaves||[]).concat([Object.fromEntries(data)]);return {status:'success',guideId:'manual-guide',newVersion:2}}`);
await writeFile(path.join(harness,'navigation.js'),`export const useRouter=()=>({refresh(){window.refreshed=true}});`);
await writeFile(path.join(harness,'notification.js'),`export function useActionNotification(){}`);
await writeFile(path.join(harness,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
await writeFile(path.join(harness,'entry.tsx'),`
import {validateOcrReview} from'${root}/src/features/vision-ocr/guide-draft';
import React from'react';import{createRoot}from'react-dom/client';import{DispatchGuideDialog}from'${root}/src/features/dispatches/components/dispatch-guide-dialog';
const realFetch=window.fetch;window.fetch=async(url,options)=>{if(!String(url).startsWith('/api/vision-ocr/guides'))return realFetch(url,options);
 if(options?.method==='PATCH'){const validation=validateOcrReview(JSON.parse(options.body).draft);if(validation)return Response.json({error:validation},{status:400});window.saves=(window.saves||[]).concat([JSON.parse(options.body)]);if(window.saves.length===1)return Response.json({error:'Foto pendiente. Reintenta.',guideId:'saved-guide'},{status:503});return Response.json({guideId:window.saves.length===2?'saved-guide':'saved-guide-2',newVersion:window.saves.length===2?3:4});}
 if(String(url).includes('action=prepare')){window.currentCapture=crypto.randomUUID();return Response.json({captureId:window.currentCapture,bucket:'fake',path:'fake',token:'fake'});}
 if(options?.method==='DELETE')return Response.json({discarded:true});window.extracts=(window.extracts||0)+1;if(window.deferNext)return Response.json({error:'Pedido / Control de operación pendiente. Omite esta página.'},{status:400});return Response.json({...${JSON.stringify(result)},captureId:window.currentCapture,draft:{...${JSON.stringify(draft)},guideNumber:window.extracts===1?'7145427':'7145428'}});};
createRoot(document.getElementById('app')).render(<DispatchGuideDialog projectId="00000000-0000-4000-8000-000000000020" dispatchId="00000000-0000-4000-8000-000000000030" programmingId="program" expectedVersion={1} programmedUnitCode="M3" operationDate="2026-10-29" defaultCatalogProduct={${JSON.stringify(product)}} units={[{code:'M3',name:'Metro cúbico'}]} onClose={()=>{window.closedGuide=true}}/>);`);
await new Promise((resolve,reject)=>webpack({mode:'development',target:'web',devtool:false,entry:path.join(harness,'entry.tsx'),output:{path:harness,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/lib/env':path.join(harness,'env.js'),'@/lib/supabase/client':path.join(harness,'client.js'),'@/components/feedback/use-action-notification':path.join(harness,'notification.js'),'@':path.join(root,'src'),'next/navigation':path.join(harness,'navigation.js')}},
 module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:path.join(harness,'loader.cjs')}]}]},plugins:[new webpack.NormalModuleReplacementPlugin(/^\.\.\/actions$/,path.join(harness,'actions.js'))]},(error,stats)=>{if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();}));
const css=(await readdir('.next/static/css')).filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/_next/static/css/${f}">`).join('');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/sample.pdf'){res.setHeader('content-type','application/pdf');res.end(await readFile(process.env.OCR_QA_PDF));return;}
 if(url.pathname==='/qa/prepared'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);assert.ok(bytes.length<4*1024*1024);await writeFile(path.join(dir,'prepared-real-guide.jpg'),bytes);res.end('OK');return;}
 if(url.pathname.endsWith('.js')){const file=path.resolve(harness,url.pathname.slice(1));assert.ok(file.startsWith(harness+'/'));res.setHeader('content-type','text/javascript');res.end(await readFile(file));return;}

 if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(await readFile(path.join(harness,'bundle.js')));return;}
 if(url.pathname.startsWith('/_next/static/')){const file=path.resolve(root,'.next',url.pathname.slice('/_next/'.length));assert.ok(file.startsWith(path.join(root,'.next/static/')));res.setHeader('content-type',file.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(file));return;}
 res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html class="${url.searchParams.get('theme')==='dark'?'dark':''}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="app"></div><script src="/bundle.js"></script></body></html>`);
}catch(e){res.statusCode=500;res.end(String(e));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const check=String.raw`(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async(fn)=>{for(let i=0;i<300;i++){if(fn())return;await pause(50)}throw Error('Timeout: '+fn)};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===text);
 await wait(()=>document.getElementById('guide-number'));await document.fonts.ready;
 const setValue=async(id,value)=>{const e=document.getElementById(id);const prototype=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,value);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause(30);};
 const manualValues={customerName:'Cliente manual',projectName:'Obra manual',workAddress:'Dirección distinta informativa',orderNumber:'PEDIDO-PAPEL',plant:'6015',truck:'0183',loadingTime:'18:27',pilot:'Piloto manual',operator:'Operador manual',observations:'Observaciones manuales'};
 const manualFieldsComplete=Object.keys(manualValues).every(k=>document.getElementById('guide-field-'+k));
 const residentLastManual=!!(document.querySelector('[aria-labelledby="guide-staff-heading"]').compareDocumentPosition(document.querySelector('[aria-labelledby="guide-resident-heading"]'))&Node.DOCUMENT_POSITION_FOLLOWING);
 for(const[k,v]of Object.entries(manualValues))await setValue('guide-field-'+k,v);
 await setValue('guide-number','MANUAL-123');await setValue('guide-truck-arrival','23:00');await setValue('guide-truck-departure','03:00');await setValue(document.querySelector('input[name="lineQuantity"]').id,'7');await setValue('guide-casting-element','PILES');document.getElementById('guide-laboratory-applied').click();await pause(100);
 document.getElementById('guide-number').scrollIntoView({block:'start'});window.qaManualReady=true;await wait(()=>window.qaManualContinue);
 document.querySelector('button[type="submit"]').click();await wait(()=>window.manualSaves?.length===1&&document.getElementById('guide-number').value==='');
 const submitted=JSON.parse(window.manualSaves[0].guideDetails);
 const manualPayloadComplete=Object.entries(manualValues).every(([k,v])=>submitted[k]===v)&&submitted.guideDate==='2026-10-29';
 const manualReset=Object.keys(manualValues).every(k=>document.getElementById('guide-field-'+k).value==='')&&document.getElementById('guide-casting-element').value===''&&!document.getElementById('guide-laboratory-applied').checked&&!window.closedGuide;

 // A legible synthetic guide image exercises the real canvas/crop pipeline.
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1600;const ctx=canvas.getContext('2d');ctx.fillStyle='#333';ctx.fillRect(0,0,1200,1600);ctx.save();ctx.translate(600,800);ctx.rotate(.04);ctx.translate(-600,-800);ctx.fillStyle='#f5f3ef';ctx.fillRect(60,80,1080,1440);ctx.fillStyle='#111';ctx.font='26px Arial';for(let y=130;y<1450;y+=60)ctx.fillText('GUIA DE DESPACHO 7145427  PROYECTO QA  86131064',95,y);ctx.restore();
 const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9)),file=new File([blob],'guia-qa.jpg',{type:'image/jpeg'}),transfer=new DataTransfer();transfer.items.add(file);transfer.items.add(new File([blob],'guia-qa-2.jpg',{type:'image/jpeg'}));transfer.items.add(new File([blob],'control-operacion.jpg',{type:'image/jpeg'}));
 const input=document.querySelector('[aria-label="Elegir foto de guía"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>button('Ajustar imagen')&&!button('Ajustar imagen').disabled);
 const automaticPreparation=!!document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]')&&!document.querySelector('img[alt="Guía a recortar"]')&&!window.extracts;
 const automaticCrop=document.body.textContent.includes('Recorte y perspectiva preparados automáticamente.');
 document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]').scrollIntoView({block:'center'});window.qaAutoReady=true;await wait(()=>window.qaAutoContinue);
 const noFilterChoice=![...document.querySelectorAll('label')].some(l=>/contraste|filtro/i.test(l.textContent));
 button('Ajustar imagen').click();
 await wait(()=>document.querySelector('img[alt="Guía a recortar"]'));
 const waitsForReading=!document.getElementById('guide-number')&&!document.querySelector('button[type="submit"]');
 const corner=document.querySelector('[aria-label="Esquina superior izquierda"]');corner.focus();corner.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await pause(100);
 window.qaCropReady=true;await wait(()=>window.qaCropContinue);button('Aplicar ajustes').click();await wait(()=>button('Aceptar foto y extraer datos'));
 const preparationHasOnePhoto=!document.querySelector('img[alt="Guía a recortar"]')&&!!document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]');
 button('Ajustar imagen').click();await wait(()=>document.querySelector('img[alt="Guía a recortar"]'));
 const backKeepsPage=document.body.textContent.includes('guia-qa.jpg')&&!window.extracts;
 button('Aplicar ajustes').click();await wait(()=>button('Aceptar foto y extraer datos'));
 const quality=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Revisé la foto y deseo continuar'));if(quality)quality.querySelector('input').click();
 const preparedVisible=!!document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]');
 button('Aceptar foto y extraer datos').click();await wait(()=>document.getElementById('ocr-projectName'));
 const populated=document.getElementById('guide-number').value==='7145427'&&document.getElementById('guide-date').value==='2026-10-29'&&document.getElementById('guide-truck-arrival').value==='23:22'&&document.getElementById('guide-truck-departure').value==='03:20'&&document.getElementById('ocr-truck').value==='0186';
 const unknownPreserved=[...document.querySelectorAll('input')].some(i=>i.value==='UNKNOWN')&&document.body.textContent.includes('Precio pendiente');
 const variants=document.querySelector('[aria-label="Variantes del catálogo"]');if(!variants)throw Error('No variants');variants.querySelectorAll('button')[1].click();await pause(100);
 const selectedVariant=[...document.querySelectorAll('[name="lineCatalogItemId"]')][2].value.endsWith('000003');
 const observationsNotCopied=[...document.querySelectorAll('[name="lineProductDescription"]')][2].value==='Bomba'&&document.getElementById('ocr-observations').value==='Observación manuscrita';
 const consistentClocks=['ocr-loadingTime','guide-truck-arrival','guide-truck-departure'].every(id=>document.getElementById(id)?.type==='time');
 const noRawText=!/Ver texto reconocido|Texto extraído por Vision|Ver horas originales leídas/.test(document.body.textContent);
 const noManualPhoto=!document.body.textContent.includes('Completar manualmente desde la foto');
 const emptyResident=document.getElementById('guide-casting-element').value===''&&!document.getElementById('guide-laboratory-applied').checked;
 const chooseResident=async()=>{const select=document.getElementById('guide-casting-element');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'PILES');select.dispatchEvent(new Event('change',{bubbles:true}));if(!document.getElementById('guide-laboratory-applied').checked)document.getElementById('guide-laboratory-applied').click();await pause(100);};
 const missingUnitOptional=[...document.querySelectorAll('select[id^="line-unit-"]')].every(e=>!e.required)&&document.querySelector('[name="lineUnitCode"]').value==='';
 const noUnitWarning=!/confirma la UM/.test(document.body.textContent);
 const residentLastOcr=!!(document.querySelector('[aria-labelledby="guide-staff-heading"]').compareDocumentPosition(document.querySelector('[aria-labelledby="guide-resident-heading"]'))&Node.DOCUMENT_POSITION_FOLLOWING);
 await chooseResident();
 const previewDetails=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Ver foto procesada y ampliar');previewDetails.open=true;
 document.querySelector('[aria-label="Ampliar foto de la guía"]').click();await wait(()=>button('Acercar'));button('Acercar').click();await pause(100);
 const inlinePreview=!!document.querySelector('[aria-label="Imagen ampliada de la guía"]')&&!document.querySelector('a[target="_blank"]')&&document.querySelector('[aria-label="Imagen ampliada de la guía"] img').style.width==='150%';
 button('Cerrar ampliación').click();previewDetails.open=false;await pause(100);
 const list=document.querySelector('[aria-label="Lista de productos y servicios"]');await pause(100);list.scrollTop=100000;await pause(100);
 const listScroll=list.children.length===5&&list.scrollTop>0&&list.scrollHeight>list.clientHeight&&list.tabIndex===0;list.scrollTop=0;
 const success=document.querySelector('p.text-success'),probe=document.createElement('span');probe.style.color='var(--success)';document.body.append(probe);const successColor=!!success&&getComputedStyle(success).color===getComputedStyle(probe).color;probe.remove();
 const panel=document.querySelector('[role="dialog"]'),scroll=document.querySelector('[data-dialog-scroll]')||panel.querySelector('.overflow-y-auto');
 const review=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Confirmo los datos corregidos'));review.querySelector('input').click();await pause(100);
 document.getElementById('guide-number').scrollIntoView({block:'start'});window.qaReviewReady=true;await wait(()=>window.qaReviewContinue);const save=document.querySelector('button[type="submit"]');if(save.disabled)throw Error('Save unexpectedly disabled');save.scrollIntoView({block:'center'});save.click();
 await wait(()=>document.querySelector('button[type="submit"]').textContent.includes('Reintentar foto'));const locked=document.getElementById('guide-number').disabled;const failedDoesNotAdvance=document.querySelector('[aria-label="Cola de guías"]').children.length===3;
 document.querySelector('button[type="submit"]').click();await wait(()=>!document.getElementById('ocr-projectName')&&window.refreshed);
 const payload=window.saves[0];
 const resetOpen=!window.closedGuide&&document.querySelectorAll('[role="dialog"]').length===1&&!document.getElementById('guide-truck-arrival')&&!document.getElementById('ocr-projectName');

 const preservedQueue=document.querySelector('[aria-label="Cola de guías"]').children.length===2&&document.body.textContent.includes('guia-qa-2.jpg');
 const extractActive=async()=>{await wait(()=>button('Ajustar imagen')&&!button('Ajustar imagen').disabled);await wait(()=>button('Aceptar foto y extraer datos'));const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Revisé la foto y deseo continuar'));if(label)label.querySelector('input').click();button('Aceptar foto y extraer datos').click();};
 await extractActive();await wait(()=>document.getElementById('guide-number')?.value==='7145428');
 const emptyReview=!document.querySelector('button[type="submit"]').disabled;
 const residentReset=document.getElementById('guide-casting-element').value===''&&!document.getElementById('guide-laboratory-applied').checked;await chooseResident();
 const secondVariants=document.querySelector('[aria-label="Variantes del catálogo"]');secondVariants.querySelectorAll('button')[1].click();
 [...document.querySelectorAll('label')].find(l=>l.textContent.includes('Confirmo los datos corregidos')).querySelector('input').click();await pause(100);document.querySelector('button[type="submit"]').click();await wait(()=>window.saves.length===3&&!document.getElementById('ocr-projectName'));
 const versionAdvanced=window.saves[2].expectedVersion===3&&window.saves[2].captureId!==window.saves[1].captureId;
 window.deferNext=true;await extractActive();await wait(()=>document.body.textContent.includes('Control de operación pendiente'));
 const deferredNoDraft=!document.getElementById('ocr-projectName')&&!document.querySelector('button[type="submit"]');
 button('Omitir esta foto').click();await wait(()=>!document.body.textContent.includes('Revisando:'));
 const pdfBlob=await(await fetch('/sample.pdf')).blob(),pdfFile=new File([pdfBlob],'muestra-cuatro-guias.pdf',{type:'application/pdf'}),pdfTransfer=new DataTransfer();pdfTransfer.items.add(pdfFile);
 const pdfInput=document.querySelector('[aria-label="Elegir PDF de guías"]');pdfInput.files=pdfTransfer.files;pdfInput.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.querySelector('[aria-label="Páginas del PDF"]')||[...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('PDF')));
 if(!document.querySelector('[aria-label="Páginas del PDF"]'))throw Error('PDF picker failed: '+document.body.textContent);
 await wait(()=>document.querySelectorAll('img[alt^="Miniatura de página"]').length===4);
 const thumbnailsReady=document.querySelectorAll('img[alt^="Miniatura de página"]').length===4;
 const pickerHidesForm=!document.getElementById('guide-number')&&!document.querySelector('img[alt="Guía a recortar"]');
 const noAutoSelection=document.querySelectorAll('[aria-label="Páginas del PDF"] input:checked').length===0;
 document.querySelector('[aria-label="Seleccionar página 1"]').click();document.querySelector('[aria-label="Seleccionar página 2"]').click();await pause(100);
 document.getElementById('guide-pages-title').scrollIntoView({block:'start'});window.qaPdfReady=true;await wait(()=>window.qaPdfContinue);
 button('Continuar con 2 guía(s)').click();
 await wait(()=>document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]')&&!button('Omitir esta página').disabled);
 const pdfQueued=document.querySelector('[aria-label="Cola de guías"]').children.length===2;
 const pdfPhoto=await(await fetch(document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]').src)).blob();
 const pdfDims=await createImageBitmap(pdfPhoto);const pdfRendered=pdfDims.width>1000&&pdfDims.height>1000,pdfLandscape=pdfDims.width>pdfDims.height;pdfDims.close();
 await fetch('/qa/prepared',{method:'POST',body:pdfPhoto});
 document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]').scrollIntoView({block:'center'});window.qaOrientationReady=true;await wait(()=>window.qaOrientationContinue);
 const eachPage=[];
 for(let number=1;number<=2;number++){
  await wait(()=>[...document.querySelectorAll('p[role="status"]')].some(p=>p.textContent.startsWith('Revisando:')&&p.textContent.includes('página '+number+' de 4'))&&document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]')&&!button('Omitir esta página').disabled);
  eachPage.push(document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]').src);button('Omitir esta página').click();
 }
 await wait(()=>!document.body.textContent.includes('Revisando:'));
 const pagesIndependent=new Set(eachPage).size===2;
 const pdfDidNotExtract=window.extracts===3;
 const queueEnded=!document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]')&&!document.getElementById('guide-number').disabled;
 const bounds=panel.getBoundingClientRect();
 return{width:innerWidth,manualFieldsComplete,manualPayloadComplete,manualReset,residentLastManual,residentLastOcr,emptyResident,missingUnitOptional,noUnitWarning,inlinePreview,listScroll,noInnerOverflow:list.scrollWidth<=list.clientWidth+1,successColor,residentReset,residentPersisted:payload.draft.resident.castingElement==='PILES'&&payload.draft.resident.laboratoryApplied===true&&payload.draft.lines[0].unit==='',pdfLandscape,consistentClocks,noRawText,noManualPhoto,automaticPreparation,automaticCrop,noFilterChoice,preparationHasOnePhoto,backKeepsPage,thumbnailsReady,pickerHidesForm,noAutoSelection,failedDoesNotAdvance,preservedQueue,versionAdvanced,deferredNoDraft,pdfQueued,pdfRendered,pagesIndependent,pdfDidNotExtract,queueEnded,reviewRequired:!emptyReview,waitsForReading,preparedVisible,populated,unknownPreserved,selectedVariant,observationsNotCopied,locked,resetOpen,oneExtraction:window.extracts===3,oneOriginalUpload:window.uploads===3,retrySameCapture:window.saves.length===3&&window.saves[0].captureId===window.saves[1].captureId,
 noClientPrice:payload.draft.lines.every(l=>!('unitPrice'in l)&&!('price'in l)),unknownSent:payload.draft.lines[1].productCode==='UNKNOWN'&&payload.draft.lines[1].catalogItemId==='',pageFits:document.documentElement.scrollWidth<=innerWidth,panelFits:bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight};
})()`;
try{
 for(const[width,height,theme]of [[320,700,'light'],[390,844,'dark'],[820,1100,'light'],[1440,1000,'light']]){
  const profile=await mkdtemp(path.join(tmpdir(),'pro-ocr-chrome-'));const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank']);let socket;
  try{
   const address=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);child.stderr.on('data',data=>{text+=data;const match=text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});child.on('error',reject)});
   socket=new WebSocket(address);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});let id=0;const waiting=new Map();
   socket.addEventListener('message',event=>{const data=JSON.parse(event.data),handler=waiting.get(data.id);if(!handler)return;waiting.delete(data.id);clearTimeout(handler.timer);if(data.error)handler.reject(Error(JSON.stringify(data.error)));else handler.resolve(data.result)});
   const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request=++id,timer=setTimeout(()=>{waiting.delete(request);reject(Error('CDP timeout: '+method))},90000);waiting.set(request,{resolve,reject,timer});socket.send(JSON.stringify({id:request,method,params,...sessionId?{sessionId}:{}}))});
   const{targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
   await send('Page.enable',{},sessionId);await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=500},sessionId);await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
   await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?theme=${theme}`},sessionId);
   const evaluation=send('Runtime.evaluate',{expression:check,awaitPromise:true,returnByValue:true},sessionId);
   const until=async flag=>{for(let i=0;i<1200;i++){const result=await send('Runtime.evaluate',{expression:flag,returnByValue:true},sessionId);if(result.result.value)return;await new Promise(r=>setTimeout(r,50));}throw Error('UI stage timeout')};
   await until('window.qaManualReady');
   const manualShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-manual.png`,Buffer.from(manualShot.data,'base64'));
   await send('Runtime.evaluate',{expression:`document.querySelector('[aria-labelledby="guide-resident-heading"]').scrollIntoView({block:'end'})`},sessionId);
   const residentShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-resident.png`,Buffer.from(residentShot.data,'base64'));
   await send('Runtime.evaluate',{expression:'window.qaManualContinue=true'},sessionId);
   await until('window.qaAutoReady');
   const autoShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-automatic.png`,Buffer.from(autoShot.data,'base64'));
   await send('Runtime.evaluate',{expression:'window.qaAutoContinue=true'},sessionId);
   await until('window.qaCropReady');
   const cropShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-crop.png`,Buffer.from(cropShot.data,'base64'));
   const crop=await send('Runtime.evaluate',{expression:`(()=>{const image=document.querySelector('img[alt="Guía a recortar"]'),r=image.getBoundingClientRect();const scroll=document.querySelector('[role="dialog"]').querySelector('.overflow-y-auto');return{x:r.left+r.width/2,y:Math.min(innerHeight-150,Math.max(170,r.top+100)),before:scroll.scrollTop,touchAction:getComputedStyle(image.parentElement).touchAction}})()`,returnByValue:true},sessionId);
   let touchScroll=true;
   if(width<=500){
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1},sessionId);
    const{x,y,before}=crop.result.value;
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]},sessionId);
    for(let step=1;step<=5;step++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*25,id:1}]},sessionId);await new Promise(r=>setTimeout(r,30));}
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},sessionId);await new Promise(r=>setTimeout(r,180));
    const after=await send('Runtime.evaluate',{expression:`document.querySelector('[role="dialog"]').querySelector('.overflow-y-auto').scrollTop`,returnByValue:true},sessionId);
    touchScroll=after.result.value>before;
   }
   assert.equal(crop.result.value.touchAction,'auto');
   await send('Runtime.evaluate',{expression:'window.qaCropContinue=true'},sessionId);
   await until('window.qaReviewReady');
   const reviewShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-review.png`,Buffer.from(reviewShot.data,'base64'));
   const region=await send('Runtime.evaluate',{expression:`(()=>{const e=document.querySelector('[aria-label="Lista de productos y servicios"]');e.scrollTop=0;e.scrollIntoView({block:'center'});e.focus({preventScroll:true});return true})()`,returnByValue:true},sessionId);
   assert.equal(region.result.value,true);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},sessionId);await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},sessionId);
   await new Promise(r=>setTimeout(r,180));
   const listKeyboardScroll=(await send('Runtime.evaluate',{expression:`document.querySelector('[aria-label="Lista de productos y servicios"]').scrollTop>0`,returnByValue:true},sessionId)).result.value;
   const rowsShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-lines.png`,Buffer.from(rowsShot.data,'base64'));
   await send('Runtime.evaluate',{expression:'window.qaReviewContinue=true'},sessionId);
   await until('window.qaPdfReady');
   const pdfShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-pdf.png`,Buffer.from(pdfShot.data,'base64'));
   await send('Runtime.evaluate',{expression:'window.qaPdfContinue=true'},sessionId);
   await until('window.qaOrientationReady');
   const orientedShot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}-real-guide.png`,Buffer.from(orientedShot.data,'base64'));
   await send('Runtime.evaluate',{expression:'window.qaOrientationContinue=true'},sessionId);
   const result=await evaluation;
   if(result.exceptionDetails){const debug=await send('Runtime.evaluate',{expression:`JSON.stringify({statuses:[...document.querySelectorAll('[role="status"]')].map(x=>x.textContent),alerts:[...document.querySelectorAll('[role="alert"]')].map(x=>x.textContent),images:[...document.images].map(x=>({alt:x.alt,src:x.src})),buttons:[...document.querySelectorAll('button')].map(x=>({text:x.textContent,disabled:x.disabled}))})`,returnByValue:true},sessionId);console.log(debug.result.value);}
   assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));const values={...result.result.value,touchScroll,listKeyboardScroll};
   const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}.png`,Buffer.from(screenshot.data,'base64'));
   for(const[key,value]of Object.entries(values))if(key!=='width')assert.equal(value,true,`${width}: ${key}`);
   console.log(JSON.stringify({status:'PASS',...values,screenshot:`${dir}/${width}-${theme}.png`}));await send('Browser.close');
  }finally{socket?.close();child.kill();child.stdin?.destroy();child.stdout?.destroy();child.stderr?.destroy();child.unref();}
 }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
