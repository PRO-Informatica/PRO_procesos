import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";

import { DELIVERY_MODES, requiresServiceInvoice } from "../src/features/programming/invoice-policy.ts";
import { extractMixtoProgrammingWorkbookBuffer } from "../src/features/programming/mixto-listo-workbook-parser.ts";

test("solo concreto directo explícito hace opcional la factura de servicio", () => {
  assert.equal(requiresServiceInvoice(["DIRECT"]), false);
  for (let mask = 0; mask < 16; mask += 1) {
    const modes = DELIVERY_MODES.filter((_, index) => mask & (1 << index));
    assert.equal(requiresServiceInvoice(modes), mask !== 1);
  }
  for (const modes of [null, undefined, [], ["UNKNOWN"], ["direct"]]) {
    assert.equal(requiresServiceInvoice(modes), true);
  }
});

const project = { billingLegalName: "QA FACTURAS SA", address: "Zona 9 Guatemala" };
async function workbook(marks = {}, includeHeaders = true) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Solicitud de Concreto");
  const cells = {
    A1: "atenciónalcliente@mixtolisto.com", A2: "Nombre destinatario de factura",
    B2: project.billingLegalName, A3: "Dirección exacta de Obra", B3: project.address,
    A5: "Datos para la Fundición", A10: "Fecha de Fundición", B10: "Hora",
    C10: "Tipo de concreto", D10: "Volumen (m3)", E10: "Elemento a fundir",
    F10: "Adicionales al concreto", G11: "DÍA PROGRAMADO", H11: "HORA PROGRAMADA",
    I11: "Pedido No.", A12: "01/10/2030", B12: "13:00", C12: "CON.3003",
    D12: 10, E12: "Muro", F12: "No inferir modalidad de estas notas: bomba",
    G12: "07/10/2030", H12: "13:00", I12: "QA-115", ...marks,
  };
  if (includeHeaders) Object.assign(cells, {
    J10: "Concreto\nDirecto", K10: "Bomba", L10: "Pluma", M10: "Colocación",
  });
  for (const [key, value] of Object.entries(cells)) sheet.getCell(key).value = value;
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("importa la X de concreto directo y la referencia sin inferir por notas", async () => {
  const { rows } = await extractMixtoProgrammingWorkbookBuffer(await workbook({ J12: " X " }), project);
  assert.deepEqual(rows[0].deliveryModes, ["DIRECT"]);
  assert.equal(rows[0].concreteType, "CON.3003");
  assert.equal(requiresServiceInvoice(rows[0].deliveryModes), false);
});

test("conserva marcas múltiples; directo más bomba requiere servicio", async () => {
  const { rows } = await extractMixtoProgrammingWorkbookBuffer(await workbook({ J12: "x", K12: "×", M12: "X" }), project);
  assert.deepEqual(rows[0].deliveryModes, ["DIRECT", "PUMP", "PLACEMENT"]);
  assert.equal(requiresServiceInvoice(rows[0].deliveryModes), true);
});

test("sin marcas o sin columnas conserva ambos requisitos y muestra advertencia", async () => {
  for (const headers of [true, false]) {
    const result = await extractMixtoProgrammingWorkbookBuffer(await workbook({}, headers), project);
    assert.deepEqual(result.rows[0].deliveryModes, []);
    assert.ok(result.warnings.some((warning) => warning.includes("sin modalidad")));
  }
});

test("una marca inválida no se convierte silenciosamente a concreto directo", async () => {
  await assert.rejects(async () => extractMixtoProgrammingWorkbookBuffer(await workbook({ J12: "SI" }), project), /marcarse con X/u);
});

test("política persistida protege cierre manual, automático y traslado", async () => {
  const sql = await readFile(new URL("../supabase/migrations/115_programming_invoice_completion_policy.sql", import.meta.url), "utf8");
  assert.match(sql, /reconciliation.status='RECONCILED'/u);
  assert.match(sql, /reconciliation.current_product_invoice_id is not null/u);
  assert.match(sql, /programming.delivery_modes = array\['DIRECT'\]::text\[\]/u);
  assert.match(sql, /create trigger guard_programming_billing_completion/u);
  assert.match(sql, /PROGRAMMING_BILLING_INCOMPLETE/u);
  assert.match(sql, /PROGRAMMING_DELIVERY_MODES_LOCKED/u);
  assert.match(sql, /and not app_private.dispatch_billing_complete\(relation.dispatch_id\)/u);
  assert.match(sql, /case when app_private.dispatch_billing_complete\(relation.dispatch_id\)/u);
  assert.match(sql, /exception.status='PENDING'/u);
  assert.doesNotMatch(sql, /disable trigger|session_replication_role|delete from public\.(invoices|dispatches|batches)/iu);
  const actions = await readFile(new URL("../src/features/programming/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /delivery_modes: row.deliveryModes/u);
  const parserOffset = actions.indexOf("export async function createProgrammingBatchAction");
  assert.match(actions.slice(parserOffset), /await extractMixtoProgrammingWorkbook\(file/u);
});
