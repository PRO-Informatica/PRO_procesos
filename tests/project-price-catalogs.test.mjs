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
    [["codigo", "precio", "descripcion", "UM"], [123, 80.64, "Bomba y operador", "M3"]],
    (sheet) => { sheet.getCell("A2").numFmt = "00000"; },
  );
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.rows[0].code, "00123");
});

test("detecta duplicados y precios inválidos antes de persistir", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "precio", "descripcion", "unidad de medida"],
    ["SERV0250", 80.64, "Bomba", "M3"],
    ["SERV0250", -1, "Bomba", "M3"],
    ["SERV0511", true, "Bomba", "M3"],
    ["SERV9999", 1.23456, "Bomba", "M3"],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.validCount, 0);
  assert.equal(result.errorCount, 4);
  assert.match(result.rows[0].errors.join(" "), /duplicada/u);
  assert.match(result.rows[1].errors.join(" "), /mayor o igual a cero/u);
  assert.match(result.rows[2].errors.join(" "), /número finito/u);
  assert.match(result.rows[3].errors.join(" "), /hasta 4 decimales/u);
});

for (const kind of ["PRODUCT", "SERVICE"]) {
  test(`${kind}: precios vacíos o con texto se normalizan a 0 sin perder registros`, async () => {
    const values = [null, "", "   ", "N/A", "-", "Pendiente", "sin precio", "Q -", "precio por definir", { richText: [{ text: "No disponible" }] }];
    const headers = kind === "PRODUCT" ? ["codigo", "referencia", "precio"] : ["codigo", "descripcion", "UM", "precio"];
    const rows = values.map((value, index) => kind === "PRODUCT"
      ? [`P${index}`, `CON.${index}`, value]
      : [`S${index}`, `Servicio ${index}`, "M3", value]);
    const result = await parseProjectPriceCatalog(await workbookFile("catalogo.xlsx", [headers, ...rows]), kind);
    assert.equal(result.totalCount, values.length);
    assert.equal(result.errorCount, 0);
    assert.ok(result.rows.every(row => row.price === "0"));
  });

  test(`${kind}: conserva precios numéricos y sigue rechazando negativos o exceso de precisión`, async () => {
    const values = [0, "0", "Q 0.00", 80.64, "Q 1,528.1234", "12,5", -1, "-1", 1.23456, "1.23456", "Infinity"];
    const headers = kind === "PRODUCT" ? ["codigo", "referencia", "precio"] : ["codigo", "descripcion", "UM", "precio"];
    const rows = values.map((value, index) => kind === "PRODUCT"
      ? [`P${index}`, `CON.${index}`, value]
      : [`S${index}`, `Servicio ${index}`, "M3", value]);
    const result = await parseProjectPriceCatalog(await workbookFile("catalogo.xlsx", [headers, ...rows]), kind);
    assert.deepEqual(result.rows.slice(0, 6).map(row => row.price), ["0", "0", "0.00", "80.64", "1528.1234", "12.5"]);
    assert.equal(result.validCount, 6);
    assert.ok(result.rows.slice(6).every(row => row.errors.length > 0));
  });
}

test("no convierte errores de Excel ni fórmulas sin calcular en precios gratuitos", async () => {
  const file = await workbookFile("productos.xlsx", [
    ["codigo", "referencia", "precio"],
    ["1", "CON.1", { error: "#VALUE!" }],
    ["2", "CON.2", { formula: "1+2" }],
    ["3", "CON.3", { formula: "1-1", result: 0 }],
    ["4", "CON.4", { formula: '"N/A"', result: "N/A" }],
  ]);
  const result = await parseProjectPriceCatalog(file, "PRODUCT");
  assert.equal(result.errorCount, 2);
  assert.ok(result.rows.slice(0, 2).every(row => row.errors.length > 0));
  assert.deepEqual(result.rows.slice(2).map(row => row.price), ["0", "0"]);
});

test("las fórmulas compartidas también preservan el cero y exigen un resultado calculado", async () => {
  const file = await workbookFile("productos.xlsx", [
    ["codigo", "referencia", "precio"],
    ["1", "CON.1", { formula: "1-1", result: 0 }],
    ["2", "CON.2", { sharedFormula: "C2", result: 0 }],
    ["3", "CON.3", { sharedFormula: "C2" }],
  ]);
  const result = await parseProjectPriceCatalog(file, "PRODUCT");
  assert.deepEqual(result.rows.slice(0, 2).map(row => row.price), ["0", "0"]);
  assert.equal(result.errorCount, 1);
  assert.match(result.rows[2].errors.join(" "), /fórmula/u);
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
  await assert.rejects(() => parseProjectPriceCatalog(regular, "SERVICE"), /columnas codigo, descripcion y precio/u);

  const archive = await JSZip.loadAsync(Buffer.from(await regular.arrayBuffer()));
  archive.file("xl/vbaProject.bin", Uint8Array.from([1, 2, 3]));
  const macroBytes = await archive.generateAsync({ type: "uint8array" });
  const macroFile = new File([macroBytes], "servicios.xlsx", { type: MIME });
  await assert.rejects(() => parseProjectPriceCatalog(macroFile, "SERVICE"), /archivo Excel/u);
});

test("servicios importan descripción y UM sin calcular IVA adicional", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["Código", "Descripción", "Unidad de Medida", "Precio (Incluye IVA)"],
    ["SERV0250", "Bomba y Operador", "m³", 80.64],
    ["SERV0255", "Cobro mínimo", "Servicio", 563.36],
    ["SERV0274", "Laboratorio", "combo", 621.6],
    ["SERV1018", "Suspensión", "Recargo", 724.36],
    ["SERV0272", "Kilometraje", "Km", 29.68],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(row => row.unitCode), ["M3", "SERVICIO", "COMBO", "RECARGO", "KM"]);
  assert.equal(result.rows[0].description, "Bomba y Operador");
  assert.equal(result.rows[0].price, "80.64");
});

test("rechaza servicios sin descripción, con UM desconocida o con fórmulas en metadatos", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "unidad", "precio"],
    ["S1", "", "M3", 1],
    ["S2", "Servicio", "litros", 1],
    ["S3", { formula: '"Bomba"', result: "Bomba" }, "M3", 1],
    ["S4", "Servicio", { formula: '"M3"', result: "M3" }, 1],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 4);
  assert.match(result.rows[0].errors.join(" "), /descripción/u);
  assert.match(result.rows[1].errors.join(" "), /UM/u);
  assert.match(result.rows[2].errors.join(" "), /fórmula/u);
  assert.match(result.rows[3].errors.join(" "), /fórmula/u);
});

test("servicios permiten la celda de UM vacía sin inventar una unidad", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "unidad de medida", "precio"],
    ["S1", "Curador rojo", null, 509.04],
    ["S2", "Curador blanco", "", 333.2],
    ["S3", "Servicio sin UM", "   ", 0],
    ["S4", "Servicio sin UM", "\u00a0", "N/A"],
    ["S5", "Bomba", "M3", 80.64],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(row => row.unitCode), [null, null, null, null, "M3"]);
  assert.deepEqual(result.rows.map(row => row.price), ["509.04", "333.2", "0", "0", "80.64"]);
});

test("servicios permiten repetir código, descripción y UM con observaciones distintas", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio", "Observaciones"],
    ["86180185", "Dosis extra de retardante (m³)", "M3", 10.92, " Una dosis "],
    ["86180185", "Dosis extra de retardante (m³)", "M3", 21.84, "Doble dosis"],
    ["86180185", "Dosis extra de retardante (m³)", "UN", 12, "Por unidad"],
    ["86180185", "Dosis extra de retardante (m³)", null, 0, null],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.validCount, 4);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(row => row.price), ["10.92", "21.84", "12", "0"]);
  assert.deepEqual(result.rows.map(row => row.unitCode), ["M3", "M3", "UN", null]);
  assert.deepEqual(result.rows.map(row => row.observations), ["Una dosis", "Doble dosis", "Por unidad", null]);
});

test("servicios siguen rechazando repetir la misma variante incluso con distinto precio", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio", "Observación"],
    ["S1", "Bomba", "m³", 10, "Una dosis"],
    ["S1", "Otro servicio", "UN", 20, " Una dosis "],
    ["S2", "Sin unidad", null, 0, null],
    ["S2", "Otra descripción", "M3", 12, "\u00a0"],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 4);
  assert.ok(result.rows.every(row => row.errors.some(error => /código y observaciones.*duplicada/u.test(error))));
});

test("observaciones son opcionales, se recortan sin alterar su contenido y rechazan fórmulas o valores inválidos", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio", "observaciones"],
    ["S1", "Servicio", null, 0, "\u00a0 Por m³ \t"],
    ["S2", "Servicio", null, 0, { formula: '"Nota"', result: "Nota" }],
    ["S3", "Servicio", null, 0, "x".repeat(501)],
    ["S4", "Servicio", null, 0, "Nota\ninterna"],
    ["S5", "Servicio", null, 0, ""],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.rows[0].observations, "Por m³");
  assert.equal(result.rows[4].observations, null);
  assert.equal(result.errorCount, 3);
  assert.match(result.rows[1].errors.join(" "), /observaciones.*fórmula/u);
  assert.match(result.rows[2].errors.join(" "), /observaciones.*500/u);
  assert.match(result.rows[3].errors.join(" "), /observaciones/u);
});

test("productos no cambian su identidad ni permiten repetir código y referencia", async () => {
  const file = await workbookFile("productos.xlsx", [
    ["codigo", "referencia", "precio"],
    ["86180185", "CON.3001", 10],
    ["86180185", "CON.3001", 20],
    ["86180185", "CON.5001", 30],
  ]);
  const result = await parseProjectPriceCatalog(file, "PRODUCT");
  assert.equal(result.errorCount, 2);
  assert.equal(result.rows[2].errors.length, 0);
  assert.ok(result.rows.slice(0, 2).every(row => row.errors.some(error => /código y referencia.*duplicada/u.test(error))));
});

test("permitir UM vacía no omite duplicados, metadatos requeridos ni fórmulas", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio"],
    ["DUP", "Una descripción", null, 1],
    ["DUP", "Una descripción", null, 2],
    ["BAD", "Servicio", "LITROS", 1],
    ["DESC", "", null, 1],
    ["FORMULA", "Servicio", { formula: '""', result: "" }, 1],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 5);
  assert.ok(result.rows.slice(0, 2).every(row => row.errors.some(error => /duplicada/u.test(error))));
  assert.match(result.rows[2].errors.join(" "), /La UM debe/u);
  assert.match(result.rows[3].errors.join(" "), /descripción/u);
  assert.match(result.rows[4].errors.join(" "), /fórmula/u);
});

test("acepta dosis/m3, dosis/m³ y Unidad del tarifario sin convertir dosis a M3", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["Código", "Descripción", "Unidad de Medida", "Precio (Incluye IVA)"],
    ["SERV0226", "Dosis extra de retardante ( m3)", "dosis/m3", 10.92],
    ["SERV0308", "Dosis para mantener trabajabilidad (m³)", "dosis/m³", 95.20],
    ["Tubo adicional", "Tubo adicional", "Unidad", 12.60],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(row => row.unitCode), ["DOSIS/M3", "DOSIS/M3", "UN"]);
  assert.deepEqual(result.rows.map(row => row.price), ["10.92", "95.2", "12.6"]);
  assert.equal(result.rows[2].code, "Tubo adicional");
});

test("el formato exige descripción de servicio y no afecta productos", async () => {
  const file = await workbookFile("servicios.xlsx", [["codigo", "precio"], ["S1", 1]]);
  await assert.rejects(() => parseProjectPriceCatalog(file, "SERVICE"), /descripcion y precio/u);
  const product = await workbookFile("productos.xlsx", [["codigo", "referencia", "precio"], ["1", { formula: '"CON.1"', result: "CON.1" }, 1]]);
  const result = await parseProjectPriceCatalog(product, "PRODUCT");
  assert.match(result.rows[0].errors.join(" "), /referencia no puede ser una fórmula/u);
});

test("acepta U y m del proveedor sin confundir metros lineales con M3", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "unidad de medida", "precio"],
    ["U1", "Corte", "U", 18.76], ["U2", "Laboratorio", " u ", 621.6],
    ["M1", "Corte lineal", "m", 22.12], ["M2", "Sello lineal", " M ", 24.92],
    ["V1", "Concreto", "m³", 80.64],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(row => row.unitCode), ["UN", "UN", "M", "M", "M3"]);
  assert.deepEqual(result.rows.map(row => row.price), ["18.76", "621.6", "22.12", "24.92", "80.64"]);
});

test("Unitario equivale a U/UN solo en el catálogo de servicios y conserva descripción, precio y observaciones", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio", "observaciones"],
    ["SERV1010", "Recargo por suspensión de obra", "Unitario", 1200.36, null],
    ["SERV1011", "Recargo por traslado de concreto <6 m³ (carga mínima)", " unitario ", 200.2, "Carga mínima"],
    ["SERV1018", "Recargo por suspensión de bomba en falso", "UNITARIO", 724.36, null],
    ["SERV1019", "Recargo por suspensión de colocación en falso", "\u00a0Unitario\u00a0", 724.36, null],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 0);
  assert.ok(result.rows.every(row => row.unitCode === "UN"));
  assert.deepEqual(result.rows.map(row => row.price), ["1200.36", "200.2", "724.36", "724.36"]);
  assert.equal(result.rows[1].observations, "Carga mínima");
  assert.equal(result.rows[1].description, "Recargo por traslado de concreto <6 m³ (carga mínima)");
});

test("servicios aceptan m²/M2 sin mezclarlos con m³/M3 ni modificar precios o referencias de observaciones", async () => {
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio", "observaciones"],
    ["SERV0282", "Aplicación de curador mayor a 100 m²", "m²", 6.44, "Cotizar por bloques de 10 m²"],
    ["SERV0259", "Alisado con helicóptero, cobro unitario por m²", " M2 ", 29.4, "Q294.00/10 m²"],
    ["SERV0261", "Colocación de pavimentos >100 m²", "M²", 30.8, "Q308.00/10 m²"],
    ["SERV0250", "Bomba", "m³", 80.64, null],
    ["SERV0252", "Pluma", "M3", 95.2, null],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.rows.map(row => row.unitCode), ["M2", "M2", "M2", "M3", "M3"]);
  assert.deepEqual(result.rows.map(row => row.price), ["6.44", "29.4", "30.8", "80.64", "95.2"]);
  assert.equal(result.rows[0].observations, "Cotizar por bloques de 10 m²");
});

test("acepta servicios sin columna UM o con guiones, pero muestra el texto de las UM desconocidas", async () => {
  const missing = await parseProjectPriceCatalog(await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "precio", "observaciones"], ["S1", "Servicio sin unidad", 5, "Nota"],
  ]), "SERVICE");
  assert.equal(missing.errorCount, 0);
  assert.equal(missing.rows[0].unitCode, null);
  const file = await workbookFile("servicios.xlsx", [
    ["codigo", "descripcion", "UM", "precio"],
    ["S1", "Vacío", null, 0], ["S2", "Guion", "-", 0],
    ["S3", "Guion largo", "—", 0], ["S4", "Guion corto", "–", 0],
    ["S5", "No soportada", "galón", 0],
  ]);
  const result = await parseProjectPriceCatalog(file, "SERVICE");
  assert.equal(result.errorCount, 1);
  assert.ok(result.rows.slice(0, 4).every(row => row.unitCode === null && row.rawUnitCode === null));
  assert.equal(result.rows[4].rawUnitCode, "galón");
  assert.match(result.rows[4].errors.join(" "), /La UM debe/u);
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
