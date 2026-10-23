// Isolated visual fixture: actual component + built CSS, no application session or data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = process.cwd();
process.umask(0o077);
const source = await readFile("src/features/platform/project-price-catalogs/components/price-catalog-preview-table.tsx", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const exports = {};
runInNewContext(compiled, { exports, require(name) {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsxRuntime;
  assert.equal(name, "@/components/ui/button");
  return { Button: ({ children, disabled }) => React.createElement("button", { disabled, className: "secondary-button" }, children) };
} });
const rows = Array.from({ length: 75 }, (_, index) => ({
  rowNumber: index + 2, code: `86180${185 + index}`, description: index === 3 ? "Descripción".repeat(40) : "Curador blanco base agua (cubeta 5 gal) · Servicio de corte y colocación",
  observations: index === 5 ? "Observación".repeat(40) : "Aplica cuando el corte es mayor a 10 metros lineales. Precio por metro, sin conversión a M3.",
  reference: null, unitCode: index % 3 === 0 ? "M" : index % 3 === 1 ? "UN" : null,
  rawUnitCode: null, price: "509.04", errors: index % 7 === 0 ? ["Error de prueba visible sin ocultar el dato de origen."] : [],
}));
const table = renderToStaticMarkup(React.createElement(exports.PriceCatalogPreviewTable, { preview: {
  fileName: "catalogo_servicios_con_observaciones.xlsx", catalogKind: "SERVICE", rows, totalCount: 75,
  validCount: 64, errorCount: 11,
} }));
const cssFiles = (await readdir(".next/static/css")).filter(file => file.endsWith(".css"));
assert.ok(cssFiles.length, "Run npm run build before visual QA.");
const links = cssFiles.map(file => `<link rel="stylesheet" href="/_next/static/css/${file}">`).join("");
const verification = `
document.fonts.ready.then(() => {
  const region=document.querySelector('[role="region"]'); region.scrollTop=230;
  if(new URL(location.href).searchParams.get('horizontal')==='right')region.scrollLeft=region.scrollWidth;
  setTimeout(() => {
    const bounds=region.getBoundingClientRect();
    // macOS overlay scrollbars are hit-testable even though clientWidth includes them.
    const contentRight=bounds.left+region.clientWidth-20;
    const headers=[...document.querySelectorAll('th')];
    const visible=headers.filter(h=>{const r=h.getBoundingClientRect();return r.right>bounds.left+8&&r.left<contentRight-8;});
    const data={width:innerWidth,pageFits:document.documentElement.scrollWidth<=innerWidth,
      containedScroll:region.scrollHeight>region.clientHeight,
      headersSticky:visible.every(h=>Math.abs(h.getBoundingClientRect().top-bounds.top)<2),
      headersOnTop:visible.every(h=>{const r=h.getBoundingClientRect();const x=(Math.max(r.left,bounds.left+2)+Math.min(r.right,contentRight-2))/2;return document.elementFromPoint(x,r.top+r.height/2)?.closest('th')===h;}),
      opaqueHeaders:headers.every(h=>getComputedStyle(h).backgroundColor!=='rgba(0, 0, 0, 0)'&&Number(getComputedStyle(h).zIndex)>0),
      headerHits:visible.map(h=>{const r=h.getBoundingClientRect();const x=(Math.max(r.left,bounds.left+2)+Math.min(r.right,contentRight-2))/2;const hit=document.elementFromPoint(x,r.top+r.height/2);return {title:h.textContent,x,y:r.top+r.height/2,hit:hit?.tagName,hitText:hit?.textContent?.slice(0,80),right:contentRight};}),
      cellsFit:[...document.querySelectorAll('td')].every(c=>c.scrollWidth<=c.clientWidth+1),
      horizontalScroll:region.scrollWidth>region.clientWidth,
      footerFits:[...document.querySelectorAll('nav button,nav select')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})};
    const result=document.createElement('pre');result.id='qa-result';result.hidden=true;result.textContent=JSON.stringify(data);document.body.append(result);
  },500);
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
    response.end(`<!doctype html><html class="${url.searchParams.get("theme") === "dark" ? "dark" : ""}" lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1">${links}<style>main{margin:20px auto;padding:24px;max-width:1200px;background:var(--surface);border:1px solid var(--border);border-radius:20px}h1{font-size:22px;margin-bottom:12px}p.intro{margin-bottom:20px;color:var(--foreground-muted)}@media(max-width:600px){main{margin:8px;padding:12px}}</style></head><body><main><h1>Importar catálogo de servicios</h1><p class="intro">Vista previa con observaciones largas y desplazamiento. Sin conexión a datos de DEV ni PROD.</p>${table}</main><script>${verification}</script></body></html>`);
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(path.join(root, "tmp/catalog-preview-ui-"));
try {
  for (const [width, height, theme, horizontal] of [[1440, 1000, "light", "left"], [820, 1100, "light", "left"], [820, 1100, "light", "right"], [390, 844, "light", "left"], [390, 844, "light", "right"], [1440, 1000, "dark", "left"]]) {
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
    for (const key of ["pageFits", "containedScroll", "headersSticky", "headersOnTop", "opaqueHeaders", "cellsFit", "footerFits"]) assert.equal(data[key], true, `${width}/${theme}: ${key} ${JSON.stringify(data.headerHits)}`);
    delete data.headerHits;
    if (width < 1088) assert.equal(data.horizontalScroll, true);
    console.log(JSON.stringify({ status: "PASS", ...data, theme, horizontal, screenshot }));
  }
} finally { await new Promise(resolve => server.close(resolve)); }
