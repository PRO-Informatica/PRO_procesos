import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import { parseProjectPriceCatalog } from "../src/features/platform/project-price-catalogs/parser.ts";

const { Workbook } = ExcelJS;
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const migration = await readFile(
  new URL("../supabase/migrations/107_project_price_catalogs.sql", import.meta.url),
  "utf8",
);
const actions = await readFile(
  new URL("../src/features/platform/project-price-catalogs/actions.ts", import.meta.url),
  "utf8",
);

async function workbookFile(name, rows, configure) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Catalogo");
  rows.forEach((row) => sheet.addRow(row));
  configure?.(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], name, { type: MIME });
}

test("acepta productos con el mismo código y referencias diferentes", async () => {
  const file = await workbookFile("productos.xlsx", [
    ["codigo", "referencia", "precio"],
    ["86130256", "CON.3003", 1089.76],
    ["86130256", "CON.3001", 1118.88],
  ]);
  const result = await parseProjectPriceCatalog(file, "PRODUCT");
  assert.equal(result.validCount, 2);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map((row) => row.reference), ["CON.3003", "CON.3001"]);
});

test("preserva ceros iniciales de códigos numéricos formateados", async () => {
  const file = await workbookFile(
    "servicios.xlsx",
    [["codigo", "precio"], [123, 80.64]],
    (sheet) => { sheet.getCell("A2").numFmt = "00000"; },
  );
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.rows[0].code, "00123");
});

test("detecta duplicados y precios inválidos antes de persistir", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "precio"],
    ["SERV0250", 80.64],
    ["SERV0250", -1],
    ["SERV0511", "texto"],
    ["SERV9999", 1.23456],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.validCount, 0);
  assert.equal(result.errorCount, 4);
  assert.match(result.rows[0].errors.join(" "), /duplicado/u);
  assert.match(result.rows[1].errors.join(" "), /mayor o igual a cero/u);
  assert.match(result.rows[2].errors.join(" "), /número finito/u);
  assert.match(result.rows[3].errors.join(" "), /hasta 4 decimales/u);
});

test("acepta una fórmula de precio solo con resultado numérico calculado", async () => {
  const file = await workbookFile(
    "productos.xlsx",
    [["codigo", "referencia", "precio"], ["1", "CON.1", null], ["2", "CON.2", null]],
    (sheet) => {
      sheet.getCell("C2").value = { formula: "100+2", result: 102 };
      sheet.getCell("C3").value = { formula: "100+3" };
    },
  );
  const result = await parseProjectPriceCatalog(file, "PRODUCT");
  assert.equal(result.rows[0].price, "102");
  assert.equal(result.rows[0].errors.length, 0);
  assert.match(result.rows[1].errors.join(" "), /fórmula/u);
});

test("rechaza macros y estructuras distintas a la esperada", async () => {
  const regular = await workbookFile("servicios.xlsx", [["otro", "precio"], ["SERV1", 1]]);
  await assert.rejects(() => parseProjectPriceCatalog(regular, "SERVICE"), /columnas codigo y precio/u);

  const archive = await JSZip.loadAsync(Buffer.from(await regular.arrayBuffer()));
  archive.file("xl/vbaProject.bin", Uint8Array.from([1, 2, 3]));
  const macroBytes = await archive.generateAsync({ type: "uint8array" });
  const macroFile = new File([macroBytes], "servicios.xlsx", { type: MIME });
  await assert.rejects(() => parseProjectPriceCatalog(macroFile, "SERVICE"), /archivo Excel/u);
});

test("la migración aísla por proyecto y usa importación atómica con RLS", () => {
  assert.match(migration, /numeric\(18,4\)/u);
  assert.match(migration, /unique \(project_id, code, reference\)/u);
  assert.match(migration, /unique \(project_id, code\)/u);
  assert.match(migration, /references public\.projects\(id\) on delete cascade/u);
  assert.match(migration, /enable row level security/u);
  assert.match(migration, /using \(app_private\.is_platform_admin\(\)\)/u);
  assert.match(migration, /security definer/u);
  assert.match(migration, /if v_mode = 'REPLACE' then[\s\S]*delete from public\.project_product_prices/u);
  assert.match(migration, /on conflict \(project_id, code, reference\)[\s\S]*do update/u);
  assert.match(migration, /insert into public\.audit_events/u);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*authenticated/iu);
});

test("el servidor vuelve a validar el Excel y la pertenencia del proyecto al confirmar", () => {
  assert.match(actions, /await parseProjectPriceCatalog\(file, catalogKind\)/u);
  assert.match(actions, /\.eq\("company_id", companyId\)/u);
  assert.match(actions, /isPlatformAdmin\(userId\)/u);
  assert.match(actions, /platform_import_project_price_catalog/u);
  assert.doesNotMatch(actions, /service.role|SERVICE_ROLE/iu);
});
