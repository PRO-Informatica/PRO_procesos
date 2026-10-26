// Actual guide form and Dialog markup with isolated hooks; no application data/session.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const root=process.cwd();process.umask(0o077);
const button=({children,disabled,className="",type="button",...props})=>React.createElement("button",{type,disabled,className:"secondary-button "+className,...props},children);
function load(source,imports,globals={}) {
  const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(compiled,{exports,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];},Intl,Date,...globals});return exports;
}
const motion=new Proxy({}, {get(_target,tag){return ({children,className,role,tabIndex,...props})=>{
  const allowed=Object.fromEntries(Object.entries(props).filter(([key])=>key.startsWith("aria-")||key==="id"));
  return React.createElement(tag,{className,role,tabIndex,...allowed},children);
};}});
const dialog=load(await readFile("src/components/ui/dialog.tsx","utf8"),{
  react:React,"react/jsx-runtime":jsxRuntime,"react-dom":{createPortal:children=>children},
  "lucide-react":icons,"motion/react":{motion,useReducedMotion:()=>true},
  "@/lib/class-names":{cn:(...args)=>args.filter(Boolean).join(" ")},
  "@/lib/motion/tokens":{motionTokens:{duration:{hover:0},scale:{dialog:1}}},
  "./icon-button":{IconButton:({children,label,disabled,onClick})=>React.createElement("button",{"aria-label":label,type:"button",disabled,onClick,className:"ghost-button size-9"},children)},
},{document:{body:{}}});
const guide=load(await readFile("src/features/dispatches/components/dispatch-guide-dialog.tsx","utf8"),{
  react:{...React,useActionState:()=>[{status:"idle"},()=>{},false]},"react/jsx-runtime":jsxRuntime,
  "lucide-react":icons,"next/navigation":{useRouter:()=>({refresh(){}})},
  "@/components/feedback/loading-button":{LoadingButton:({children,disabled})=>React.createElement("button",{type:"submit",disabled,className:"primary-button"},children)},
  "@/components/feedback/use-action-notification":{useActionNotification(){}},
  "@/components/ui/button":{Button:button},"@/components/ui/dialog":dialog,
  "@/components/ui/icon-button":{IconButton:({children,label,disabled,onClick})=>React.createElement("button",{type:"button","aria-label":label,disabled,onClick,className:"ghost-button size-9"},children)},
  "@/lib/notification-messages":{notifications:{}},"../actions":{saveDispatchGuideAction(){}},
  "../catalog-selection":{catalogSelectionDefaults(){}},
  "../../platform/project-price-catalogs/service-units":{SERVICE_UNIT_CODES:["M3","M2","UN"]},
  "../formatters":{formatDispatchMoney:value=>"Q "+Number(value).toFixed(2)},
  "../types":{initialDispatchMutationState:{status:"idle"}},
  "./dispatch-catalog-picker-dialog":{DispatchCatalogPickerDialog:()=>null},
}).DispatchGuideDialog;
const table=renderToStaticMarkup(React.createElement(guide,{
  projectId:"project",programmingId:"program",dispatchId:"dispatch",expectedVersion:1,programmedUnitCode:"M3",timezone:"America/Guatemala",units:[{code:"M3"}],onClose(){},
  guide:{id:"guide",guideNumber:"1234",guideDate:"2026-10-26",truckArrivalAt:"2026-10-26T21:30:00Z",truckDepartureAt:"2026-10-26T22:10:00Z",lines:[{id:"line",quantity:7.5,unitCode:"M3",catalogType:"PRODUCT",catalogItemId:"product",productCode:"86131066",catalogReference:"CONF5001",productDescription:"CONF5001",unitPrice:1298.08,currency:"GTQ"}]},
}));
const cssFiles=(await readdir(".next/static/css")).filter(file=>file.endsWith(".css"));
assert.ok(cssFiles.length,"Run npm run build first");
const links=cssFiles.map(file=>'<link rel="stylesheet" href="/_next/static/css/'+file+'">').join("");
const verification=`
document.fonts.ready.then(()=>{
  setTimeout(()=>{
    const panel=document.querySelector('[role="dialog"]');
    const inputs=[document.getElementById('guide-truck-arrival'),document.getElementById('guide-truck-departure')];
    const bounds=panel.getBoundingClientRect();
    const data={width:innerWidth,pageFits:document.documentElement.scrollWidth<=innerWidth,
      panelFits:bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight,
      contentsFit:[...panel.querySelectorAll('input:not([type="hidden"]),select,label')].every(el=>{const r=el.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right;}),
      timesCorrect:inputs[0].value==='15:30'&&inputs[1].value==='16:10',
      labelled:inputs.every(el=>document.querySelector('label[for="'+el.id+'"]')),
      required:inputs.every(el=>el.required&&el.type==='time')};
    inputs[1].value='14:00';data.reverseRejected=inputs[1].validity.rangeUnderflow;inputs[1].value='16:10';
    inputs[0].focus();data.focusable=document.activeElement===inputs[0];
    const result=document.createElement('pre');result.hidden=true;result.id='qa-result';result.textContent=JSON.stringify(data);document.body.append(result);
  },300);
});`;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/_next/static/")) {
      const file = path.resolve(root, ".next", url.pathname.slice("/_next/".length));
      assert.ok(file.startsWith(path.join(root, ".next/static/")));
      response.setHeader("content-type", file.endsWith(".css") ? "text/css" : "font/woff2");
      response.end(await readFile(file)); return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html class="${url.searchParams.get("theme") === "dark" ? "dark" : ""}" lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1">${links}<style>main{margin:20px auto;padding:24px;max-width:1200px;background:var(--surface);border:1px solid var(--border);border-radius:20px}h1{font-size:22px;margin-bottom:12px}p.intro{margin-bottom:20px;color:var(--foreground-muted)}@media(max-width:600px){main{margin:8px;padding:12px}}</style></head><body>${table}<script>${verification}</script></body></html>`);
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(path.join(root, "tmp/dispatch-guide-times-ui-"));
try {
  for (const [width, height, theme, horizontal] of [[1440, 1000, "light", "left"], [820, 1100, "light", "left"], [390, 844, "light", "left"], [1440, 1000, "dark", "left"]]) {
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
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?theme=${theme}&horizontal=${horizontal}` }, sessionId);
      const result = await send("Runtime.evaluate", { expression: `new Promise((resolve,reject)=>{let count=0;const poll=()=>{const el=document.getElementById('qa-result');if(el)resolve(JSON.parse(el.textContent));else if(++count>100)reject(Error('No verification result'));else setTimeout(poll,80);};poll();})`, awaitPromise: true, returnByValue: true }, sessionId);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      data = result.result.value;
      const capture = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(screenshot, Buffer.from(capture.data, "base64"), { mode: 0o600 });
      await send("Browser.close");
    } finally {
      socket?.close();
      child.kill();
    }
    for (const key of ["pageFits", "panelFits", "contentsFit", "timesCorrect", "labelled", "required", "reverseRejected", "focusable"]) assert.equal(data[key], true, `${width}/${theme}: ${key} ${JSON.stringify(data.headerHits)}`);
    delete data.headerHits;
    console.log(JSON.stringify({ status: "PASS", ...data, theme, horizontal, screenshot }));
  }
} finally { await new Promise(resolve => server.close(resolve)); }
