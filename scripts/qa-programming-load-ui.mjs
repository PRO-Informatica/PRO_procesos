// Hydrated real calendar/workspace with synthetic server actions; no real records.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd();process.umask(0o077);
await mkdir('tmp',{recursive:true});
const harness=await mkdtemp(path.join(tmpdir(),'pro-programming-load-'));
await writeFile(path.join(harness,'actions.js'),`export async function loadProgrammingRange(project,range,filters){window.rangeCalls=(window.rangeCalls||[]).concat([{project,range,filters}]);await new Promise(r=>setTimeout(r,70));return{status:'success',items:window.fixtures.filter(i=>i.scheduledAt>=range.start&&i.scheduledAt<range.end&&(!filters.status||i.effectiveStatus===filters.status))};}export async function mutateProgrammingAction(_state,data){window.cancelPayload=[...data.entries()];return window.failCancel?{status:'error',message:'Error simulado, conserva el comentario'}:{status:'success'};}`);
await writeFile(path.join(harness,'notification.js'),`export function useActionNotification(){}`);
await writeFile(path.join(harness,'navigation.js'),`export const useRouter=()=>({refresh(){}});`);
await writeFile(path.join(harness,'link.js'),`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`);
await writeFile(path.join(harness,'stubs.js'),`export function CreateProgrammingDialog(){return null;}export function BulkProgrammingDialog(){return null;}export function ProgrammingEditDialog(){return null;}`);
await writeFile(path.join(harness,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
await writeFile(path.join(harness,'entry.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';
import{ProgrammingWorkspace}from'${root}/src/features/programming/components/programming-workspace';
import 'temporal-polyfill/global';
const timezone='America/Guatemala';const now=Temporal.Now.zonedDateTimeISO(timezone);const today=now.toPlainDate();const first=today.with({day:1});const boundary=first.subtract({days:(first.dayOfWeek-1)||1});
const stamp=date=>date.toZonedDateTime({timeZone:timezone,plainTime:Temporal.PlainTime.from('07:00')}).toInstant().toString();
const item=(id,date,name,status='CONFIRMED')=>({id,version:2,projectId:'project',supplierId:'supplier',supplierName:name,orderNumber:'123',scheduledAt:stamp(date),requestedQuantity:5,confirmedQuantity:5,unitCode:'M3',placementGroup:null,requiresPumping:false,deliveryModes:['DIRECT'],estimatedWorkItemId:null,estimatedWorkItemLabel:null,status,effectiveStatus:status,notes:null,createdByName:'QA',confirmedAt:stamp(date),confirmedByName:'QA',lines:[{id:'line',quantity:5,unitCode:'M3',concreteType:'CONF4001',position:1}],dispatches:[]});
window.todayItem=item('today-item',today,'QA HOY');window.boundaryItem=item('boundary-item',boundary,'QA PRIMERA SEMANA');window.fixtures=[window.todayItem,window.boundaryItem];
createRoot(document.getElementById('app')!).render(<ProgrammingWorkspace project={{id:'project',name:'QA',companyName:'QA',timezone}} canCreate={false} canConfirm={false} canModify={false} canCancel={true} initialData={{items:[window.todayItem],range:{start:stamp(first),end:stamp(first.add({months:1,days:7}))},suppliers:[],units:[]}}/>);`);
await new Promise((resolve,reject)=>webpack({mode:'development',target:'web',devtool:false,
 entry:path.join(harness,'entry.tsx'),output:{path:harness,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/components/feedback/use-action-notification':path.join(harness,'notification.js'),'@':path.join(root,'src'),'next/navigation':path.join(harness,'navigation.js'),'next/link':path.join(harness,'link.js')}},
 module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:path.join(harness,'loader.cjs')}]}]},
 plugins:[new webpack.NormalModuleReplacementPlugin(/^\.\.\/actions$/,path.join(harness,'actions.js')),new webpack.NormalModuleReplacementPlugin(/^\.\/(create-programming-dialog|bulk-programming-dialog|programming-edit-dialog)$/,path.join(harness,'stubs.js'))],
},(error,stats)=>{if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();}));
const cssFiles=(await readdir('.next/static/css')).filter(f=>f.endsWith('.css'));assert.ok(cssFiles.length,'Run build first');
const links=cssFiles.map(f=>'<link rel="stylesheet" href="/_next/static/css/'+f+'">').join('');
await writeFile(path.join(harness,'browser-check.js'),String.raw`(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async fn=>{for(let n=0;n<160;n++){if(fn())return;await pause(50);}throw Error('UI timeout: '+fn);};
 const visibleEvent=id=>[...document.querySelectorAll('[data-event-id="'+id+'"]')].some(el=>el.getClientRects().length);
 const choose=async(el,value)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));await pause(50);};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===text);
 await wait(()=>document.querySelector('.sx__calendar'));await document.fonts.ready;
 await wait(()=>window.rangeCalls?.length>0);await wait(()=>visibleEvent('today-item'));
 const firstLoad=window.rangeCalls.length>0,initialEvent=visibleEvent('today-item');
 const previousVisible=window.boundaryItem.scheduledAt>=window.rangeCalls[0].range.start;
 if(previousVisible&&innerWidth>=700)await wait(()=>visibleEvent('boundary-item')).catch(error=>{throw Error(error.message+JSON.stringify({calls:window.rangeCalls,fixtures:window.fixtures,calendar:document.querySelector('.sx__calendar').textContent}));});
 const boundaryEvent=!previousVisible||innerWidth<700||visibleEvent('boundary-item');
 // Changing filters and navigating back must work without reloading the page.
 await choose(document.getElementById('programming-filter-status'),'COMPLETED');await wait(()=>!visibleEvent('today-item'));
 const filterWorks=!visibleEvent('today-item');
 await choose(document.getElementById('programming-filter-status'),'');await wait(()=>visibleEvent('today-item'));
 const next=document.querySelector('.sx__chevron--next')?.closest('button');
 const prev=document.querySelector('.sx__chevron--previous')?.closest('button');
 if(!next||!prev)throw Error('Calendar navigation buttons missing');
 const calls=window.rangeCalls.length;next.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>window.rangeCalls.length>calls).catch(error=>{throw Error(error.message+JSON.stringify({width:innerWidth,title:document.querySelector('.sx__range-heading')?.textContent,header:document.querySelector('.sx__calendar-header')?.textContent,calls:window.rangeCalls}));});await wait(()=>!visibleEvent('today-item'));const navigationWorks=true;
 const after=window.rangeCalls.length;prev.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>window.rangeCalls.length>after);await wait(()=>visibleEvent('today-item'));const returnWorks=true;
 document.querySelector('[data-event-id="today-item"]').click();await wait(()=>button('Cancelar programación'));const cancelVisible=true;
 button('Cancelar programación').click();await wait(()=>document.getElementById('programming-cancel-reason'));
 const reason=document.getElementById('programming-cancel-reason');const form=reason.closest('form');const submit=form.querySelector('[type="submit"]');
 const reasonRequired=reason.required&&submit.disabled;
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(reason,'Prueba cancelación con comentario');reason.dispatchEvent(new Event('input',{bubbles:true}));await pause(50);
 window.failCancel=true;submit.click();await wait(()=>form.querySelector('[role="alert"]')&&!submit.disabled);
 const errorRetained=reason.value==='Prueba cancelación con comentario';window.failCancel=false;submit.click();await wait(()=>!document.getElementById('programming-cancel-reason'));
 const cancelSuccess=window.cancelPayload.some(([key,value])=>key==='reason'&&value==='Prueba cancelación con comentario')&&window.cancelPayload.some(([key,value])=>key==='intent'&&value==='cancel')&&window.cancelPayload.some(([key,value])=>key==='expectedVersion'&&value==='2');
 return{width:innerWidth,firstLoad,initialEvent,boundaryEvent,filterWorks,navigationWorks,returnWorks,cancelVisible,reasonRequired,errorRetained,cancelSuccess,pageFits:document.documentElement.scrollWidth<=innerWidth};
})()`);
const server=createServer(async(request,response)=>{try{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(await readFile(path.join(harness,'bundle.js')));return;}
 if(url.pathname.startsWith('/_next/static/')){const file=path.resolve(root,'.next',url.pathname.slice('/_next/'.length));assert.ok(file.startsWith(path.join(root,'.next/static/')));response.setHeader('content-type',file.endsWith('.css')?'text/css':'font/woff2');response.end(await readFile(file));return;}
 response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><html lang="es" class="'+(url.searchParams.get('theme')==='dark'?'dark':'')+'"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+links+'</head><body><div id="app"></div><script src="/bundle.js"></script></body></html>');
}catch(error){response.statusCode=500;response.end(String(error));}});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(path.join(root, "tmp/programming-load-ui-"));
try {
  for (const [width, height, theme, horizontal] of [[320, 700, "light", "left"], [390, 844, "light", "left"], [820, 1100, "light", "left"], [1440, 1000, "light", "left"], [390, 844, "dark", "left"]]) {
    const screenshot = path.join(directory, `${width}-${theme}-${horizontal}.png`);
    const profile = await mkdtemp(path.join(directory, "chrome-profile-"));
    const child = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"]);
    let socket;
    let data;
    try {
      const address = await new Promise((resolve, reject) => {
        let stderr = "";
        const timeout = setTimeout(() => reject(new Error("Headless Chrome startup timeout")), 15000);
        child.stderr.on("data", part => {
          stderr += part;
          const address = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+)/u)?.[1];
          if (address) { clearTimeout(timeout); resolve(address); }
        });
        child.on("error", error => { clearTimeout(timeout); reject(error); });
      });
      socket = new WebSocket(address);
      await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
      let id = 0;
      const waiting = new Map();
      socket.addEventListener("message", event => {
        const result = JSON.parse(event.data);
        const handler = waiting.get(result.id);
        if (!handler) return;
        waiting.delete(result.id); clearTimeout(handler.timeout);
        if (result.error) handler.reject(new Error(JSON.stringify(result.error)));
        else handler.resolve(result.result);
      });
      const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(() => { waiting.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        waiting.set(requestId, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      await send("Page.enable", {}, sessionId);
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?theme=${theme}${horizontal==='edit'?'&edit=1':''}` }, sessionId);
      const result = await send("Runtime.evaluate", { expression: await readFile(path.join(harness,"browser-check.js"),"utf8"), awaitPromise: true, returnByValue: true }, sessionId);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      data = result.result.value;
      const capture = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(screenshot, Buffer.from(capture.data, "base64"), { mode: 0o600 });
      await send("Browser.close");
    } finally {
      socket?.close();
      child.kill();
    }
    for (const key of ["firstLoad", "initialEvent", "boundaryEvent", "filterWorks", "navigationWorks", "returnWorks", "cancelVisible", "reasonRequired", "errorRetained", "cancelSuccess", "pageFits"]) assert.equal(data[key], true, `${width}/${theme}: ${key} ${JSON.stringify(data.headerHits)}`);
    delete data.headerHits;
    console.log(JSON.stringify({ status: "PASS", ...data, theme, horizontal, screenshot }));
  }
} finally { await new Promise(resolve => server.close(resolve)); }
