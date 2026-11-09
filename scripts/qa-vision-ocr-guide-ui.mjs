// Isolated hydrated-component checks. Fake API/catalog; never signs into PROD.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd();process.umask(0o077);await mkdir('tmp',{recursive:true});
const dir=await mkdtemp('tmp/vision-ocr-guide-ui-'),harness=await mkdtemp(path.join(tmpdir(),'pro-ocr-ui-'));
const product={id:'00000000-0000-4000-8000-000000000001',type:'PRODUCT',code:'86131064',reference:'CONF4001',description:null,observations:null,unitCode:null,price:1224.16,currency:'GTQ'};
const service={...product,id:'00000000-0000-4000-8000-000000000002',type:'SERVICE',code:'SERV1',reference:null,description:'Bomba',observations:'Variante para volumen menor a 6',unitCode:'UN',price:100};
const variant={...service,id:'00000000-0000-4000-8000-000000000003',observations:'Variante para volumen mayor a 6',price:200};
const details={documentType:'DISPATCH_GUIDE',customerName:'Cliente QA',projectName:'Proyecto QA',workAddress:'1 calle 3-45 zona 1 Guatemala',guideDate:'2026-10-29',orderNumber:'999',plant:'QU',truck:'0186',loadingTime:'18:00',pilot:'Piloto QA',operator:'0079',observations:'Observación manuscrita'};
const line={quantity:'1',unit:'UN',productCode:'SERV1',description:'Bomba',type:'SERVICE',catalogItemId:'',candidates:[service,variant],warning:'Selecciona la variante'};
const draft={guideNumber:'7145427',arrivalTime:'23:22',departureTime:'03:20',details,rawTimes:{loading:'6 pm',arrival:'23:22',departure:'03:20'},confidence:{projectName:.7},warnings:['Revisa el proyecto','Línea 1: confirma la UM «ma».'],lines:[{...line,quantity:'7',unit:'',productCode:product.code,description:product.reference,type:'PRODUCT',catalogItemId:product.id,candidates:[product],warning:null},{...line,productCode:'UNKNOWN',description:'Servicio no catalogado',candidates:[],warning:'Precio pendiente'},line,{...line,unit:'',catalogItemId:service.id,candidates:[service],warning:null},{...line,unit:'',catalogItemId:service.id,candidates:[service],warning:null}]};
const result={imageRotation:3,captureId:'00000000-0000-4000-8000-000000000010',draft,rawText:'Texto OCR de prueba',project:{name:'Proyecto QA',code:'QA',address:details.workAddress,additionalAddresses:[]}};
await writeFile(path.join(harness,'env.js'),`export const getPublicEnvironment=()=>({appEnvironment:'DEV'});`);
await writeFile(path.join(harness,'client.js'),`export const createClient=()=>({storage:{from:()=>({uploadToSignedUrl:async()=>{window.uploads=(window.uploads||0)+1;return{data:{},error:null};}})}});`);
await writeFile(path.join(harness,'actions.js'),`export async function searchDispatchCatalogAction(){return{status:'success',items:${JSON.stringify([product,service,variant])}}};export async function saveDispatchGuideAction(){throw Error('OCR must use its guarded endpoint')}`);
await writeFile(path.join(harness,'navigation.js'),`export const useRouter=()=>({refresh(){window.refreshed=true}});`);
await writeFile(path.join(harness,'notification.js'),`export function useActionNotification(){}`);
await writeFile(path.join(harness,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
await writeFile(path.join(harness,'entry.tsx'),`
import {validateOcrReview} from'${root}/src/features/vision-ocr/guide-draft';
import React from'react';import{createRoot}from'react-dom/client';import{DispatchGuideDialog}from'${root}/src/features/dispatches/components/dispatch-guide-dialog';
const realFetch=window.fetch;window.fetch=async(url,options)=>{if(!String(url).startsWith('/api/vision-ocr/guides'))return realFetch(url,options);
 if(options?.method==='PATCH'){const validation=validateOcrReview(JSON.parse(options.body).draft);if(validation)return Response.json({error:validation},{status:400});window.saves=(window.saves||[]).concat([JSON.parse(options.body)]);if(window.saves.length===1)return Response.json({error:'Foto pendiente. Reintenta.',guideId:'saved-guide'},{status:503});return Response.json({guideId:'saved-guide',newVersion:2});}
 if(String(url).includes('action=prepare'))return Response.json({captureId:'00000000-0000-4000-8000-000000000010',bucket:'fake',path:'fake',token:'fake'});
 if(options?.method==='DELETE')return Response.json({discarded:true});window.extracts=(window.extracts||0)+1;return Response.json(${JSON.stringify(result)});};
createRoot(document.getElementById('app')).render(<DispatchGuideDialog projectId="00000000-0000-4000-8000-000000000020" dispatchId="00000000-0000-4000-8000-000000000030" programmingId="program" expectedVersion={1} programmedUnitCode="M3" defaultCastingElement="PILES_AND_COLUMNS" operationDate="2026-10-29" defaultCatalogProduct={${JSON.stringify(product)}} units={[{code:'M3',name:'Metro cúbico'}]} onClose={()=>{window.closedGuide=true}}/>);`);
await new Promise((resolve,reject)=>webpack({mode:'development',target:'web',devtool:false,entry:path.join(harness,'entry.tsx'),output:{path:harness,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/lib/env':path.join(harness,'env.js'),'@/lib/supabase/client':path.join(harness,'client.js'),'@/components/feedback/use-action-notification':path.join(harness,'notification.js'),'@':path.join(root,'src'),'next/navigation':path.join(harness,'navigation.js')}},
 module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:path.join(harness,'loader.cjs')}]}]},plugins:[new webpack.NormalModuleReplacementPlugin(/^\.\.\/actions$/,path.join(harness,'actions.js'))]},(error,stats)=>{if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();}));
const css=(await readdir('.next/static/css')).filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/_next/static/css/${f}">`).join('');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(await readFile(path.join(harness,'bundle.js')));return;}
 if(url.pathname.startsWith('/_next/static/')){const file=path.resolve(root,'.next',url.pathname.slice('/_next/'.length));assert.ok(file.startsWith(path.join(root,'.next/static/')));res.setHeader('content-type',file.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(file));return;}
 res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html class="${url.searchParams.get('theme')==='dark'?'dark':''}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="app"></div><script src="/bundle.js"></script></body></html>`);
}catch(e){res.statusCode=500;res.end(String(e));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const check=String.raw`(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async(fn)=>{for(let i=0;i<300;i++){if(fn())return;await pause(50)}throw Error('Timeout: '+fn)};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===text);
 await wait(()=>document.getElementById('guide-number'));await document.fonts.ready;
 // A legible synthetic guide image exercises the real canvas/crop pipeline.
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1600;const ctx=canvas.getContext('2d');ctx.fillStyle='#eee5df';ctx.fillRect(0,0,1200,1600);ctx.fillStyle='#111';ctx.font='28px Arial';for(let y=80;y<1500;y+=60)ctx.fillText('GUIA DE DESPACHO 7145427  PROYECTO QA  86131064',50,y);
 const sideways=document.createElement('canvas');sideways.width=1600;sideways.height=1200;const side=sideways.getContext('2d');side.translate(1600,0);side.rotate(Math.PI/2);side.drawImage(canvas,0,0);
 const blob=await new Promise(r=>sideways.toBlob(r,'image/jpeg',.9)),file=new File([blob],'guia-qa.jpg',{type:'image/jpeg'}),transfer=new DataTransfer();transfer.items.add(file);
 const input=document.querySelector('[aria-label="Elegir foto de guía"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>button('Ajustar imagen')&&!button('Ajustar imagen').disabled);
 const automaticPreparation=!!document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]')&&!document.querySelector('img[alt="Guía a recortar"]')&&!window.extracts;
 const noFilterChoice=![...document.querySelectorAll('label')].some(l=>/contraste|filtro/i.test(l.textContent));
 button('Ajustar imagen').click();
 await wait(()=>document.querySelector('img[alt="Guía a recortar"]'));
 const waitsForReading=!document.getElementById('guide-number')&&!document.querySelector('button[type="submit"]');
 const corner=document.querySelector('[aria-label="Esquina superior izquierda"]');corner.focus();corner.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await pause(100);
 window.qaCropReady=true;await wait(()=>window.qaCropContinue);button('Aplicar ajustes').click();await wait(()=>button('Aceptar foto y extraer datos'));
 const quality=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Revisé la foto y deseo continuar'));if(quality)quality.querySelector('input').click();
 const beforeBitmap=await createImageBitmap(await(await fetch(document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]').src)).blob());
 const beforeDimensions=[beforeBitmap.width,beforeBitmap.height];beforeBitmap.close();
 const preparedVisible=!!document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]');
 button('Aceptar foto y extraer datos').click();await wait(()=>document.getElementById('detected-guide-type'));const detectsBeforeForm=!document.getElementById('guide-number')&&!document.querySelector('button[type="submit"]');[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Continuar con Guía')).click();await wait(()=>document.getElementById('ocr-projectName'));
 const afterBitmap=await createImageBitmap(await(await fetch(document.querySelector('img[alt="Recorte de la guía, con perspectiva corregida"]').src)).blob());
 const uprightPreview=afterBitmap.width===beforeDimensions[1]&&afterBitmap.height===beforeDimensions[0];afterBitmap.close();
 const populated=document.getElementById('guide-number').value==='7145427'&&document.getElementById('guide-date').value==='2026-10-29'&&document.getElementById('guide-truck-arrival').value==='23:22'&&document.getElementById('guide-truck-departure').value==='03:20'&&document.getElementById('ocr-truck').value==='0186';
 const unknownPreserved=[...document.querySelectorAll('input')].some(i=>i.value==='UNKNOWN')&&document.body.textContent.includes('Precio pendiente');
 const variants=document.querySelector('[aria-label="Variantes de la cotización"]');if(!variants)throw Error('No variants');variants.querySelectorAll('button')[1].click();await pause(100);
 const selectedVariant=[...document.querySelectorAll('[name="lineCatalogItemId"]')][2].value.endsWith('000003');
 const observationsNotCopied=[...document.querySelectorAll('[name="lineProductDescription"]')][2].value==='Bomba'&&document.getElementById('ocr-observations').value==='Observación manuscrita';
 const residentDefault=document.getElementById('guide-casting-element').value==='PILES_AND_COLUMNS'&&!document.getElementById('guide-laboratory-applied').checked;
 const chooseResident=async()=>{const select=document.getElementById('guide-casting-element');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'PILES');select.dispatchEvent(new Event('change',{bubbles:true}));if(!document.getElementById('guide-laboratory-applied').checked)document.getElementById('guide-laboratory-applied').click();await pause(100);};
 const missingUnitOptional=[...document.querySelectorAll('select[id^="line-unit-"]')].every(e=>!e.required)&&document.querySelector('[name="lineUnitCode"]').value==='';
 const noUnitWarning=!/confirma la UM/.test(document.body.textContent);
 await chooseResident();
 const previewDetails=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Ver foto procesada y ampliar');previewDetails.open=true;
 document.querySelector('[aria-label="Ampliar foto de la guía"]').click();await wait(()=>button('Acercar'));button('Acercar').click();await pause(100);
 const inlinePreview=!!document.querySelector('[aria-label="Imagen ampliada de la guía"]')&&!document.querySelector('a[target="_blank"]')&&document.querySelector('[aria-label="Imagen ampliada de la guía"] img').style.width==='150%';
 button('Cerrar ampliación').click();previewDetails.open=false;await pause(100);
 const list=document.querySelector('[aria-label="Lista de productos y servicios"]');await pause(100);list.scrollTop=100000;await pause(100);
 const listScroll=list.children.length===5&&list.scrollTop>0&&list.scrollHeight>list.clientHeight&&list.tabIndex===0;list.scrollTop=0;
 const success=document.querySelector('p.text-success');const successColor=!!success&&success.classList.contains('text-success');
 const panel=document.querySelector('[role="dialog"]'),scroll=document.querySelector('[data-dialog-scroll]')||panel.querySelector('.overflow-y-auto');
 const review=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Confirmo los datos corregidos'));review.querySelector('input').click();await pause(100);
 document.getElementById('guide-number').scrollIntoView({block:'start'});window.qaReviewReady=true;await wait(()=>window.qaReviewContinue);const save=document.querySelector('button[type="submit"]');if(save.disabled)throw Error('Save unexpectedly disabled');save.scrollIntoView({block:'center'});save.click();
 await wait(()=>document.querySelector('button[type="submit"]').textContent.includes('Reintentar foto'));const locked=document.getElementById('guide-number').disabled;
 document.querySelector('button[type="submit"]').click();await wait(()=>document.getElementById('guide-number').value===''&&window.refreshed);
 const payload=window.saves[0];
 const residentDefaultAfterSave=document.getElementById('guide-casting-element').value==='PILES_AND_COLUMNS';
 const resetOpen=!window.closedGuide&&document.querySelectorAll('[role="dialog"]').length===1&&document.getElementById('guide-truck-arrival').value===''&&!document.getElementById('ocr-projectName');
 const bounds=panel.getBoundingClientRect();
 return{width:innerWidth,detectsBeforeForm,residentDefault,residentDefaultAfterSave,missingUnitOptional,noUnitWarning,inlinePreview,listScroll,successColor,automaticPreparation,noFilterChoice,uprightPreview,waitsForReading,preparedVisible,populated,unknownPreserved,selectedVariant,observationsNotCopied,locked,resetOpen,oneExtraction:window.extracts===1,oneOriginalUpload:window.uploads===1,retrySameCapture:window.saves.length===2&&window.saves[0].captureId===window.saves[1].captureId,
 noClientPrice:payload.draft.lines.every(l=>!('unitPrice'in l)&&!('price'in l)),unknownSent:payload.draft.lines[1].productCode==='UNKNOWN'&&payload.draft.lines[1].catalogItemId==='',pageFits:document.documentElement.scrollWidth<=innerWidth,panelFits:bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight};
})()`;
try{
 for(const[width,height,theme]of [[320,700,'light'],[390,844,'dark'],[820,1100,'light'],[1440,1000,'light']]){
  const profile=await mkdtemp(path.join(tmpdir(),'pro-ocr-chrome-'));const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank']);let socket;
  try{
   const address=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);child.stderr.on('data',data=>{text+=data;const match=text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});child.on('error',reject)});
   socket=new WebSocket(address);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});let id=0;const waiting=new Map();
   socket.addEventListener('message',event=>{const data=JSON.parse(event.data),handler=waiting.get(data.id);if(!handler)return;waiting.delete(data.id);clearTimeout(handler.timer);if(data.error)handler.reject(Error(JSON.stringify(data.error)));else handler.resolve(data.result)});
   const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request=++id,timer=setTimeout(()=>{waiting.delete(request);reject(Error('CDP timeout: '+method))},30000);waiting.set(request,{resolve,reject,timer});socket.send(JSON.stringify({id:request,method,params,...sessionId?{sessionId}:{}}))});
   const{targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
   await send('Page.enable',{},sessionId);await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=500},sessionId);await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
   await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?theme=${theme}`},sessionId);
   const evaluation=send('Runtime.evaluate',{expression:check,awaitPromise:true,returnByValue:true},sessionId);
   const until=async flag=>{for(let i=0;i<200;i++){const result=await send('Runtime.evaluate',{expression:flag,returnByValue:true},sessionId);if(result.result.value)return;await new Promise(r=>setTimeout(r,50));}throw Error('UI stage timeout')};
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
   await send('Runtime.evaluate',{expression:'window.qaReviewContinue=true'},sessionId);
   const result=await evaluation;assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));const values={...result.result.value,touchScroll};
   const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(`${dir}/${width}-${theme}.png`,Buffer.from(screenshot.data,'base64'));
   for(const[key,value]of Object.entries(values))if(key!=='width')assert.equal(value,true,`${width}: ${key}`);
   console.log(JSON.stringify({status:'PASS',...values,screenshot:`${dir}/${width}-${theme}.png`}));await send('Browser.close');
  }finally{socket?.close();child.kill();child.stdin?.destroy();child.stdout?.destroy();child.stderr?.destroy();child.unref();}
 }
}finally{await new Promise(resolve=>server.close(resolve));}
