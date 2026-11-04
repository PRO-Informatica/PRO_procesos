// Cross-device status/color QA against the hydrated calendar, drawer, filters and Kanban. Synthetic actions only.
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
const harness=await mkdtemp(path.join(tmpdir(),'pro-programming-status-'));
await writeFile(path.join(harness,'actions.js'),`export async function loadProgrammingRange(project,range,filters){window.rangeCalls=(window.rangeCalls||[]).concat([{project,range,filters}]);await new Promise(r=>setTimeout(r,70));return{status:'success',items:window.fixtures.filter(i=>i.scheduledAt>=range.start&&i.scheduledAt<range.end&&(!filters.status||i.effectiveStatus===filters.status))};}export async function mutateProgrammingAction(_state,data){window.cancelPayload=[...data.entries()];return window.failCancel?{status:'error',message:'Error simulado, conserva el comentario'}:{status:'success'};}`);
await writeFile(path.join(harness,'notification.js'),`export function useActionNotification(){}`);
await writeFile(path.join(harness,'navigation.js'),`export const useRouter=()=>({refresh(){}});`);
await writeFile(path.join(harness,'link.js'),`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`);
await writeFile(path.join(harness,'stubs.js'),`export function CreateProgrammingDialog(){return null;}export function BulkProgrammingDialog(){return null;}export function ProgrammingEditDialog(){return null;}`);
await writeFile(path.join(harness,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
await writeFile(path.join(harness,'entry.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{ThemeProvider}from'next-themes';
import{ProgrammingWorkspace}from'${root}/src/features/programming/components/programming-workspace';
import 'temporal-polyfill/global';
const timezone='America/Guatemala';const now=Temporal.Now.zonedDateTimeISO(timezone);const today=now.toPlainDate();const first=today.with({day:1});const boundary=first.subtract({days:(first.dayOfWeek-1)||1});
const stamp=date=>date.toZonedDateTime({timeZone:timezone,plainTime:Temporal.PlainTime.from('07:00')}).toInstant().toString();
const item=(id,date,name,status='CONFIRMED')=>({id,version:2,projectId:'project',supplierId:'supplier',supplierName:name,orderNumber:'123',scheduledAt:stamp(date),requestedQuantity:5,confirmedQuantity:5,unitCode:'M3',placementGroup:null,requiresPumping:false,deliveryModes:['DIRECT'],estimatedWorkItemId:null,estimatedWorkItemLabel:null,status,effectiveStatus:status,notes:null,createdByName:'QA',confirmedAt:stamp(date),confirmedByName:'QA',lines:[{id:'line',quantity:5,unitCode:'M3',concreteType:'CONF4001',position:1}],dispatches:[]});
window.fixtures=['CONFIRMED','IN_EXECUTION','DISPATCH_COMPLETED','COMPLETED','CANCELLED'].map(status=>item(status,today,'QA '+status,status));window.fixtures.push({...item('EXPIRED',today,'QA EXPIRED','CONFIRMED'),effectiveStatus:'EXPIRED'});
const rootNode=createRoot(document.getElementById('app')!);rootNode.render(<ThemeProvider attribute="class" enableSystem={false} storageKey="qa-status-theme" defaultTheme={new URLSearchParams(location.search).get('theme')||'light'}><ProgrammingWorkspace project={{id:'project',name:'QA',companyName:'QA',timezone}} canCreate={false} canConfirm={true} canModify={true} canCancel={true} initialData={{items:window.fixtures,range:{start:stamp(first),end:stamp(first.add({months:1,days:7}))},suppliers:[],units:[]}}/></ThemeProvider>);`);
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
 const visible=el=>el?.getClientRects().length>0;
 const choose=async(el,value)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));await pause(80);};
 const button=text=>[...document.querySelectorAll('button')].find(b=>visible(b)&&b.textContent.trim()===text);
 await wait(()=>document.querySelector('.sx__calendar'));await document.fonts.ready;await wait(()=>window.rangeCalls?.length>0);
 const legend=document.querySelector('[aria-label="Guía Estados"]');
 const legendColors=!!legend&&['Confirmado','En ejecución','Despacho completo','Completado','Cancelado','Vencido'].every(label=>[...legend.querySelectorAll('li')].some(e=>e.textContent===label));
 const legendFits=!!legend&&[legend,...legend.querySelectorAll('li')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;});
 const status=document.getElementById('programming-filter-status');const opts=[...status.options].map(o=>o.value);
 const noPending=!opts.includes('PENDING_CONFIRMATION')&&!opts.includes('DRAFT');const hasDispatchCompleted=opts.includes('DISPATCH_COMPLETED');
 const dark=new URLSearchParams(location.search).get('theme')==='dark';
 const expected=dark?{CONFIRMED:'rgb(32, 59, 75)',IN_EXECUTION:'rgb(25, 58, 64)',DISPATCH_COMPLETED:'rgb(0, 0, 0)',COMPLETED:'rgb(29, 53, 87)',CANCELLED:'rgb(69, 29, 35)',EXPIRED:'rgb(41, 54, 44)'}:{CONFIRMED:'rgb(234, 242, 246)',IN_EXECUTION:'rgb(168, 218, 220)',DISPATCH_COMPLETED:'rgb(0, 0, 0)',COMPLETED:'rgb(29, 53, 87)',CANCELLED:'rgb(253, 236, 239)',EXPIRED:'rgb(241, 250, 238)'};
 const accentColors=['rgb(69, 123, 157)','rgb(168, 218, 220)','rgb(0, 0, 0)','rgb(29, 53, 87)','rgb(230, 57, 70)','rgb(241, 250, 238)'];
 const paletteMatches=!!legend&&[...legend.querySelectorAll('li span[aria-hidden]')].every((e,i)=>getComputedStyle(e).backgroundColor===accentColors[i]);
 const luminance=rgb=>(rgb.match(/[\d.]+/g)||[]).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const contrast=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
 const contrasts={};
 const colors={};for(const[id,color]of Object.entries(expected)){
   await choose(status,id);await wait(()=>[...document.querySelectorAll('[data-event-id="'+id+'"]')].some(visible));
   const event=[...document.querySelectorAll('[data-event-id="'+id+'"]')].find(visible);await wait(()=>getComputedStyle(event).backgroundColor===color).catch(error=>{throw Error(error.message+JSON.stringify({id,color,actual:getComputedStyle(event).backgroundColor,html:event.outerHTML,children:[...event.children].map(e=>({tag:e.tagName,bg:getComputedStyle(e).backgroundColor}))}));});
   colors[id]=getComputedStyle(event).backgroundColor;
   const ratio=contrast(getComputedStyle(event).color,colors[id]);if(ratio<4.5)throw Error('Insufficient text contrast: '+id+' '+ratio);contrasts[id]=Number(ratio.toFixed(2));
 }
 await choose(status,'DISPATCH_COMPLETED');await wait(()=>[...document.querySelectorAll('[data-event-id="DISPATCH_COMPLETED"]')].some(visible));
 document.querySelector('[data-event-id="DISPATCH_COMPLETED"]').click();await wait(()=>document.querySelector('[role="dialog"]'));
 const drawer=document.querySelector('[role="dialog"]');const completedBadge=[...drawer.querySelectorAll('span')].find(e=>e.textContent==='Despacho completo');
 const drawerBlack=!!completedBadge&&getComputedStyle(completedBadge).backgroundColor===expected.DISPATCH_COMPLETED&&getComputedStyle(completedBadge).color==='rgb(255, 255, 255)';
 const noManualConfirm=!button('Confirmar programación');button('Cerrar')?.click();
 // Drawer close is icon-only, with its accessible label.
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!document.querySelector('[role="dialog"]'));
 await choose(status,'');button('Kanban').click();await wait(()=>document.getElementById('kanban-mobile-status'));
 const legendOnlyCalendar=!document.querySelector('[aria-label="Guía Estados"]');
 const mobile=document.getElementById('kanban-mobile-status');const kanbanOptions=[...mobile.options].map(o=>o.value);
 const kanbanStates=kanbanOptions.length===6&&!kanbanOptions.includes('PENDING_CONFIRMATION')&&kanbanOptions.includes('DISPATCH_COMPLETED');
 if(innerWidth<1024)await choose(mobile,'DISPATCH_COMPLETED');
 await pause(100);const pageFits=document.documentElement.scrollWidth<=innerWidth;
 return{width:innerWidth,noPending,hasDispatchCompleted,colors,drawerBlack,noManualConfirm,kanbanStates,pageFits,legendColors,legendFits,legendOnlyCalendar,paletteMatches,contrasts};
})()`);
const server=createServer(async(request,response)=>{try{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(await readFile(path.join(harness,'bundle.js')));return;}
 if(url.pathname.startsWith('/_next/static/')){const file=path.resolve(root,'.next',url.pathname.slice('/_next/'.length));assert.ok(file.startsWith(path.join(root,'.next/static/')));response.setHeader('content-type',file.endsWith('.css')?'text/css':'font/woff2');response.end(await readFile(file));return;}
 response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><html lang="es" class="'+(url.searchParams.get('theme')==='dark'?'dark':'')+'"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+links+'</head><body><div id="app"></div><script src="/bundle.js"></script></body></html>');
}catch(error){response.statusCode=500;response.end(String(error));}});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(path.join(root, "tmp/programming-status-ui-"));
try {
  for (const [width, height, theme, horizontal] of [[320, 700, "light", "states"], [390, 844, "light", "states"], [820, 1100, "light", "states"], [1440, 1000, "light", "states"], [390, 844, "dark", "states"], [1440, 1000, "dark", "states"]]) {
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
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?theme=${theme}${horizontal==='started'?'&started=1':''}` }, sessionId);
      const result = await send("Runtime.evaluate", { expression: await readFile(path.join(harness,"browser-check.js"),"utf8"), awaitPromise: true, returnByValue: true }, sessionId);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      data = result.result.value;
      const capture = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(screenshot, Buffer.from(capture.data, "base64"), { mode: 0o600 });
      const calendar = await send("Runtime.evaluate", { expression: `(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Calendario').click();for(let i=0;i<150;i++){if([...document.querySelectorAll('[data-event-id="DISPATCH_COMPLETED"]')].some(el=>el.getClientRects().length)){await new Promise(r=>setTimeout(r,100));return true;}await new Promise(r=>setTimeout(r,50));}throw Error('Calendar screenshot not ready');})()`, awaitPromise: true, returnByValue: true }, sessionId);
      assert.ok(!calendar.exceptionDetails, JSON.stringify(calendar.exceptionDetails));
      const calendarCapture = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(screenshot.replace('.png','-calendar.png'), Buffer.from(calendarCapture.data, "base64"), { mode: 0o600 });
      await send("Browser.close");
    } finally {
      socket?.close();
      child.kill();
    }
    for (const key of ["noPending", "hasDispatchCompleted", "drawerBlack", "noManualConfirm", "kanbanStates", "pageFits", "legendColors", "legendFits", "legendOnlyCalendar", "paletteMatches"]) assert.equal(data[key], true, `${width}/${theme}: ${key} ${JSON.stringify(data.headerHits)}`);
    delete data.headerHits;
    console.log(JSON.stringify({ status: "PASS", ...data, theme, horizontal, screenshot }));
  }
} finally { await new Promise(resolve => server.close(resolve)); }
