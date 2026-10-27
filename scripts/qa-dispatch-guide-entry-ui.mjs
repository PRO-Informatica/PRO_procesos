// Hydrated production components with fake catalog/action boundaries. No user data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir,mkdtemp,readFile,readdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
const require=createRequire(import.meta.url);
const {webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd();process.umask(0o077);
await mkdir('tmp',{recursive:true});
const harness=await mkdtemp(path.join(tmpdir(),'pro-dispatch-entry-harness-'));
const product={id:'00000000-0000-4000-8000-000000000001',type:'PRODUCT',code:'86131064',reference:'CONF4001',description:null,observations:null,unitCode:null,price:1224.16,currency:'GTQ'};
const service={id:'00000000-0000-4000-8000-000000000002',type:'SERVICE',code:'86180185',reference:null,description:'Dosis extra de retardante',observations:'Una dosis por metro cúbico',unitCode:'M3',price:10.92,currency:'GTQ'};
const variant={...service,id:'00000000-0000-4000-8000-000000000003',observations:'Doble dosis por metro cúbico, aplicar según especificación de obra',price:21.84};
await writeFile(path.join(harness,'actions.js'),`export async function searchDispatchCatalogAction(project,type,query){await new Promise(r=>setTimeout(r,80));return {status:'success',items:${JSON.stringify([product,service,variant])}.filter(i=>(type==='ALL'||i.type===type)&&[i.code,i.reference,i.description,i.observations].some(v=>(v||'').toLowerCase().includes(query.toLowerCase())))};} export async function saveDispatchGuideAction(_state,data){window.savedGuide=[...data.entries()];return window.failGuideSave?{status:'error',message:'Prueba de conservación del formulario'}:{status:'success'};}`);
await writeFile(path.join(harness,'navigation.js'),`export const useRouter=()=>({refresh(){}});`);
await writeFile(path.join(harness,'notification.js'),`export function useActionNotification(){}`);
await writeFile(path.join(harness,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
await writeFile(path.join(harness,'entry.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';
import{DispatchGuideDialog}from'${root}/src/features/dispatches/components/dispatch-guide-dialog';
const product=${JSON.stringify(product)};
createRoot(document.getElementById('app')!).render(<DispatchGuideDialog
 projectId="project" dispatchId="dispatch" programmingId="programming" expectedVersion={1}
 programmedUnitCode="M3" operationDate="2026-10-24" dispatchArrivalTime="07:00"
 defaultCatalogProduct={product} units={[{code:'M3',name:'Metro cúbico'}]} onClose={()=>{window.guideClosed=true;}}/>);`);
await new Promise((resolve,reject)=>webpack({mode:'development',target:'web',devtool:false,
 entry:path.join(harness,'entry.tsx'),output:{path:harness,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/components/feedback/use-action-notification':path.join(harness,'notification.js'),'@':path.join(root,'src'),'next/navigation':path.join(harness,'navigation.js')}},
 module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:path.join(harness,'loader.cjs')}]}]},
 plugins:[new webpack.NormalModuleReplacementPlugin(/^\.\.\/actions$/,path.join(harness,'actions.js'))],
},(error,stats)=>{if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();}));
const cssFiles=(await readdir('.next/static/css')).filter(f=>f.endsWith('.css'));
assert.ok(cssFiles.length,'Run build first');
const links=cssFiles.map(f=>'<link rel="stylesheet" href="/_next/static/css/'+f+'">').join('');
await writeFile(path.join(harness,'browser-check.js'),String.raw`(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async fn=>{for(let n=0;n<120;n++){const r=fn();if(r)return r;await pause(50);}throw Error('UI timeout: '+fn);};
 const set=async(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await pause(30);};
 const key=async(el,value)=>{el.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));await pause(50);};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 await wait(()=>document.getElementById('guide-number'));await document.fonts.ready;
 const panel=document.querySelector('[role="dialog"]');
 const dateDefault=document.getElementById('guide-date').value==='2026-10-24';
 await set(document.getElementById('guide-number'),'1234');
 await set(document.getElementById('guide-truck-arrival'),'07:00');
 await set(document.getElementById('guide-truck-departure'),'07:45');
 const first=document.querySelector('[name="lineQuantity"]');await set(first,'7');
 button('Agregar producto / servicio').click();await pause(50);
 let combos=[...document.querySelectorAll('[role="combobox"]')];
 combos[1].focus();await set(combos[1],'dosis');
 await wait(()=>document.querySelectorAll('[role="option"]').length===2);
 const list=document.querySelector('[role="listbox"]');
 const searchFits=[...list.querySelectorAll('[role="option"]')].every(o=>{const r=o.getBoundingClientRect(),p=panel.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;});
 if(!list.textContent.includes('Doble dosis'))throw Error('Missing service variant observation');
 await key(combos[1],'ArrowDown');await key(combos[1],'Enter');
 const ids=()=>[...document.querySelectorAll('[name="lineCatalogItemId"]')].map(e=>e.value);
 const variantSelected=ids()[1].endsWith('000003');
 const keyboardSelect=!document.querySelector('[role="listbox"]')&&variantSelected;
 const descriptions=[...document.querySelectorAll('[name="lineProductDescription"]')].map(e=>e.value);
 const observationsNotCopied=descriptions[1]==='Dosis extra de retardante'&&!panel.textContent.includes('Doble dosis');
 const lineIsolation=ids()[0].endsWith('000001')&&first.value==='7';
 await set(document.querySelectorAll('[name="lineQuantity"]')[1],'7');
 button('Agregar producto / servicio').click();await pause(50);
 combos=[...document.querySelectorAll('[role="combobox"]')];combos[2].focus();await set(combos[2],'CONF');
 await wait(()=>document.querySelectorAll('[role="option"]').length===1);
 document.querySelector('[role="option"]').click();await pause(50);
 const touchSelect=ids().length===3&&ids()[2].endsWith('000001');
 document.querySelector('[aria-label="Eliminar línea 3"]').click();await pause(50);
 const cards=[...panel.querySelectorAll('article')];
 const cardsSeparated=cards.length===2&&cards.every(c=>c.querySelector('h4'))&&cards[1].getBoundingClientRect().top>cards[0].getBoundingClientRect().bottom;
 // Escape closes only suggestions, preserving the guide and its draft.
 combos=[...document.querySelectorAll('[role="combobox"]')];combos[1].focus();combos[1].click();await set(combos[1],'861');
 await wait(()=>document.querySelectorAll('[role="option"]').length===3);
 await key(combos[1],'Escape');
 if(window.guideClosed||document.querySelector('[role="listbox"]'))throw Error('Escape closed guide or left suggestions');
 window.failGuideSave=true;
 panel.querySelector('button[type="submit"]').click();await wait(()=>panel.querySelector('[role="alert"]')&&!panel.querySelector('button[type="submit"]').disabled);
 const errorDraftRetained=document.querySelectorAll('[name="lineQuantity"]')[1].value==='7'&&panel.querySelectorAll('select')[1].value==='M3'&&ids()[1].endsWith('000003');
 if(!errorDraftRetained)throw Error('Draft reset: '+JSON.stringify({selects:[...panel.querySelectorAll('select')].map(el=>el.value),quantities:[...panel.querySelectorAll('[name="lineQuantity"]')].map(el=>el.value),ids:ids(),saved:window.savedGuide}));
 window.failGuideSave=false;window.savedGuide=null;
 panel.querySelector('button[type="submit"]').click();await wait(()=>window.savedGuide);
 const values=name=>window.savedGuide.filter(p=>p[0]===name).map(p=>p[1]);
 const payloadCorrect=values('lineCatalogItemId').length===2&&values('lineCatalogItemId')[1].endsWith('000003')&&values('lineUnitCode').every(v=>v==='M3')&&values('truckArrivalTime')[0]==='07:00'&&values('truckDepartureTime')[0]==='07:45'&&!window.savedGuide.some(p=>/observation/i.test(p[0]));
 const bounds=panel.getBoundingClientRect();
 const data={width:innerWidth,pageFits:document.documentElement.scrollWidth<=innerWidth,
 panelFits:bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight,
 contentsFit:[...panel.querySelectorAll('input:not([type="hidden"]),select,textarea,label')].every(el=>{const r=el.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right;}),
 cardsSeparated,searchFits,keyboardSelect,variantSelected,observationsNotCopied,lineIsolation,touchSelect,dateDefault,errorDraftRetained,noNestedDialog:document.querySelectorAll('[role="dialog"]').length===1,payloadCorrect};
 // Capture an open dropdown with service variants, just as on the user's phone.
 combos[1].focus();combos[1].click();await set(combos[1],'dosis');await wait(()=>document.querySelectorAll('[role="option"]').length===2);
 document.querySelector('[role="listbox"]').scrollIntoView({block:'center'});await pause(100);
 return data;
})()`);
const server=createServer(async(request,response)=>{try{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(await readFile(path.join(harness,'bundle.js')));return;}
 if(url.pathname.startsWith('/_next/static/')){const file=path.resolve(root,'.next',url.pathname.slice('/_next/'.length));assert.ok(file.startsWith(path.join(root,'.next/static/')));response.setHeader('content-type',file.endsWith('.css')?'text/css':'font/woff2');response.end(await readFile(file));return;}
 response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><html lang="es" class="'+(url.searchParams.get('theme')==='dark'?'dark':'')+'"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+links+'</head><body><div id="app"></div><script src="/bundle.js"></script></body></html>');
}catch(error){response.statusCode=500;response.end(String(error));}});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(path.join(root, "tmp/dispatch-guide-entry-ui-"));
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
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?theme=${theme}` }, sessionId);
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
    for (const key of ["pageFits", "panelFits", "contentsFit", "cardsSeparated", "searchFits", "keyboardSelect", "variantSelected", "observationsNotCopied", "lineIsolation", "touchSelect", "dateDefault", "errorDraftRetained", "noNestedDialog", "payloadCorrect"]) assert.equal(data[key], true, `${width}/${theme}: ${key} ${JSON.stringify(data.headerHits)}`);
    delete data.headerHits;
    console.log(JSON.stringify({ status: "PASS", ...data, theme, horizontal, screenshot }));
  }
} finally { await new Promise(resolve => server.close(resolve)); }
