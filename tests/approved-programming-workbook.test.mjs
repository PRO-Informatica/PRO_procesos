import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  extractMixtoProgrammingWorkbookBuffer,
  isApprovedProgrammingDayAllowed,
} from "../src/features/programming/mixto-listo-workbook-parser.ts";

const project = {
  billingLegalName: "INMOBILIARIA LOS ANTURIOS, S.A.",
  address: "9a Calle 5A-62 zona 9 Quetzaltenango",
};

async function workbookBuffer(overrides = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Solicitud #9 SABIETA");
  sheet.getCell("A1").value = "atenciónalcliente@mixtolisto.com";
  sheet.getCell("A2").value = "Nombre destinatario de factura";
  sheet.getCell("B2").value = project.billingLegalName;
  sheet.getCell("A3").value = "Dirección exacta de Obra";
  sheet.getCell("B3").value = project.address;
  sheet.getCell("A5").value = "Datos para la Fundición";
  const headers = {
    A10: "Fecha de Fundición", B10: "Hora", C10: "No. De pedido",
    D10: "Tipo de concreto", E10: "Volumen (m3)", F10: "Elemento a fundir",
    G10: "Tiempo entre camiones", H10: "Adicionales al concreto",
    I11: "DÍA PROGRAMADO", J11: "HORA PROGRAMADA", K11: "Pedido No.",
    ...overrides.headers,
  };
  for (const [cell, value] of Object.entries(headers)) sheet.getCell(cell).value = value;
  const row = {
    A12: "01/01/2030", B12: "08:00", C12: "PEDIDO-INCORRECTO",
    D12: "CONA3000", E12: 45, F12: "Soil Nailing", G12: "30 minutos",
    H12: "Coordinar Bomba", I12: "07.10.2030", J12: "13:00", K12: "28",
    ...overrides.row,
  };
  for (const [cell, value] of Object.entries(row)) sheet.getCell(cell).value = value;
  for (const [cell, numFmt] of Object.entries(overrides.formats ?? {})) {
    sheet.getCell(cell).numFmt = numFmt;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("usa DÍA/HORA PROGRAMADA y Pedido No. de la segunda fila de encabezados", async () => {
  const result = await extractMixtoProgrammingWorkbookBuffer(await workbookBuffer(), project);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].scheduledAt, "2030-10-07T13:00");
  assert.equal(result.rows[0].orderNumber, "28");
  assert.notEqual(result.rows[0].orderNumber, "PEDIDO-INCORRECTO");
});

for (const label of ["Fecha Programada", "FECHA PROGRAMADA", "  Fecha\nProgramada  "]) {
  test(`acepta el encabezado alternativo ${JSON.stringify(label)} sin confundir la fecha solicitada`, async () => {
    const { rows: [row] } = await extractMixtoProgrammingWorkbookBuffer(
      await workbookBuffer({ headers: { I11: label } }), project,
    );
    assert.equal(row.scheduledAt, "2030-10-07T13:00");
    assert.equal(row.orderNumber, "28");
    assert.equal(row.quantity, "45");
  });
}

for (const [dateLabel, timeColumn, orderColumn] of [
  ["DÍA PROGRAMADO", "N", "O"],
  ["Fecha Programada", "O", "N"],
]) {
  test(`lee ${dateLabel} con encabezados combinados y Hora/Pedido en orden ${timeColumn}/${orderColumn}`, async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Solicitud de Concreto");
    for (const [cell, value] of Object.entries({
      A1: "atencionalcliente@mixtolisto.com",
      A2: "Nombre destinatario de factura", B2: project.billingLegalName,
      A3: "Dirección exacta de Obra", B3: project.address,
      A20: "Datos para la Fundición",
    })) sheet.getCell(cell).value = value;
    for (const [range, value] of [
      ["A23:B24", "Fecha de Fundición"], ["C23:C24", "Hora"],
      ["D23:D24", "Tipo de concreto"], ["E23:F24", "Volumen (m3)"],
      ["G23:G24", "Elemento a fundir"], ["H23:H24", "Tiempo entre camiones"],
      ["I23:I24", "Concreto Directo"], ["J23:J24", "Bomba"],
      ["K23:K24", "Pluma"], ["L23:L24", "Colocación"],
      ["M23:M24", dateLabel], [`${timeColumn}23:${timeColumn}24`, "Hora\nProgramada"],
      [`${orderColumn}23:${orderColumn}24`, "Pedido No."], ["P23:Q24", "Adicionales al concreto"],
    ]) {
      sheet.mergeCells(range);
      sheet.getCell(range.split(":")[0]).value = value;
    }
    for (const rowNumber of [25, 26]) {
      for (const [first, last] of [["A", "B"], ["E", "F"], ["P", "Q"]]) sheet.mergeCells(`${first}${rowNumber}:${last}${rowNumber}`);
      for (const [column, value] of Object.entries({
        A: "01/01/2030", C: "08:00", D: "CONB3001", E: rowNumber === 25 ? 24 : 7.5,
        G: "Losa", H: "30 minutos", J: "X", P: "Contemplar tubos adicionales",
        M: rowNumber === 25 ? "26/10/2030" : new Date("2030-10-27T00:00:00Z"),
        [timeColumn]: rowNumber === 25 ? "07:00AM" : new Date("1899-12-30T15:00:00Z"),
        [orderColumn]: rowNumber === 25 ? "000145" : 146,
      })) sheet.getCell(`${column}${rowNumber}`).value = value;
    }
    sheet.getCell(`${orderColumn}26`).numFmt = "000000";
    const { rows } = await extractMixtoProgrammingWorkbookBuffer(Buffer.from(await workbook.xlsx.writeBuffer()), project);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => [row.sourceRow, row.scheduledAt, row.orderNumber, row.quantity]), [
      [25, "2030-10-26T07:00", "000145", "24"],
      [26, "2030-10-27T15:00", "000146", "7.5"],
    ]);
    assert.deepEqual(rows[0].deliveryModes, ["PUMP"]);
    assert.equal(rows[0].additions, "Contemplar tubos adicionales");
  });
}

test("usa exclusivamente Pedido No. aunque No. De pedido tenga otro valor", async () => {
  const { rows: [row] } = await extractMixtoProgrammingWorkbookBuffer(
    await workbookBuffer({ row: { C12: 111, K12: 999 } }),
    project,
  );
  assert.equal(row.orderNumber, "999");
  assert.notEqual(row.orderNumber, "111");
});

test("preserva Pedido No. como texto con ceros y admite identificadores alfanuméricos", async () => {
  const formatted = await extractMixtoProgrammingWorkbookBuffer(
    await workbookBuffer({
      row: { C12: "ABC", K12: 123 },
      formats: { K12: "000000" },
    }),
    project,
  );
  assert.equal(formatted.rows[0].orderNumber, "000123");

  const alphanumeric = await extractMixtoProgrammingWorkbookBuffer(
    await workbookBuffer({ row: { K12: "PED-123-A" } }),
    project,
  );
  assert.equal(alphanumeric.rows[0].orderNumber, "PED-123-A");
});

test("permite una hora pasada del día actual en una carga aprobada", () => {
  const currentProjectDateTime = "2026-10-07T14:00";
  const approvedDateTime = "2026-10-07T08:00";
  assert.ok(approvedDateTime < currentProjectDateTime);
  assert.equal(
    isApprovedProgrammingDayAllowed(approvedDateTime, "2026-10-07"),
    true,
  );
});

test("rechaza un día anterior en una carga aprobada", () => {
  assert.equal(
    isApprovedProgrammingDayAllowed("2026-10-06T23:59", "2026-10-07"),
    false,
  );
});

test("persiste en el DTO tipo, volumen M3 y notas operativas", async () => {
  const { rows: [row] } = await extractMixtoProgrammingWorkbookBuffer(await workbookBuffer(), project);
  assert.equal(row.concreteType, "CONA3000");
  assert.equal(row.quantity, "45");
  assert.equal(row.unitCode, "M3");
  assert.equal(row.notes, "Elemento a fundir: Soil Nailing\nAdicionales al concreto: Coordinar Bomba\nTiempo entre camiones: 30 minutos");
});

for (const [name, row, message] of [
  ["DÍA PROGRAMADO", { I12: "" }, /Fila Excel 12: DÍA PROGRAMADO faltante o inválido/u],
  ["HORA PROGRAMADA", { J12: "" }, /Fila Excel 12: HORA PROGRAMADA faltante o inválida/u],
  ["Pedido No.", { K12: "" }, /Fila Excel 12: Pedido No\. es obligatorio/u],
  ["Tipo de concreto", { D12: "" }, /Fila Excel 12: Tipo de concreto es obligatorio/u],
  ["volumen cero", { E12: 0 }, /Fila Excel 12: Volumen \(m3\) debe ser mayor que cero/u],
  ["volumen negativo", { E12: -1 }, /Fila Excel 12: Volumen \(m3\) debe ser mayor que cero/u],
]) {
  test(`rechaza una fila aprobada sin ${name}`, async () => {
    await assert.rejects(
      extractMixtoProgrammingWorkbookBuffer(await workbookBuffer({ row }), project),
      message,
    );
  });
}

test("rechaza la plantilla cuando faltan las columnas de aprobación", async () => {
  await assert.rejects(
    extractMixtoProgrammingWorkbookBuffer(await workbookBuffer({
      headers: { I11: "", J11: "" },
    }), project),
    /debe venir aprobado por Mixto Listo/u,
  );
});

test("la migración conserva históricos y confirma el lote atómicamente", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/100_approved_programming_workbook.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /add column if not exists order_number text/u);
  assert.match(sql, /add column if not exists concrete_type text/u);
  assert.doesNotMatch(sql, /order_number text not null/u);
  assert.match(sql, /create or replace function public\.create_programming_batch/u);
  assert.match(sql, /perform app_private\.confirm_programming_core/u);
  assert.match(sql, /APPROVED_MIXTO_WORKBOOK/u);
  assert.match(sql, /'CONFIRMED'/u);
  assert.match(sql, /v_scheduled_at <= clock_timestamp\(\)/u);
  assert.match(sql, /v_programming\.order_number/u);
  assert.match(sql, /line\.concrete_type/u);
  assert.match(sql, /begin;[\s\S]*commit;/u);
});

test("la migración 101 aplica la regla por día local solo a la carga aprobada", async () => {
  const sql = await readFile(new URL(
    "../supabase/migrations/101_approved_programming_same_day.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /clock_timestamp\(\) at time zone v_timezone\)::date/u);
  assert.match(sql, /\(v_scheduled_at at time zone v_timezone\)::date < v_today/u);
  assert.doesNotMatch(sql, /if v_scheduled_at <= clock_timestamp\(\)/u);
  assert.match(sql, /APPROVED_MIXTO_WORKBOOK/u);
  assert.match(sql, /v_confirmation_source is distinct from 'APPROVED_MIXTO_WORKBOOK'/u);
  assert.match(sql, /new\.scheduled_at <= clock_timestamp\(\)/u);
  assert.match(sql, /perform app_private\.confirm_programming_core/u);
});

test("despacho y guía consumen los campos estructurados", async () => {
  const [queries, workspace, detail, guide] = await Promise.all([
    readFile(new URL("../src/features/dispatches/queries.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dispatches/components/dispatches-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dispatches/components/dispatch-detail-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dispatches/components/dispatch-guide-dialog.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(queries, /order_number/u);
  assert.match(queries, /programming_lines/u);
  assert.match(workspace, /No\. de pedido/u);
  assert.match(workspace, /Tipo de concreto/u);
  assert.match(workspace, /item\.orderNumber/u);
  assert.match(workspace, /item\.concreteTypes/u);
  assert.match(detail, /Pedido No\./u);
  assert.match(detail, /Tipo de concreto/u);
  assert.match(detail, /detail\.orderNumber \?\? detail\.programmingOrderNumber/u);
  assert.match(guide, /initialLine\(programmedUnitCode, defaultProductDescription \?\? "", defaultCatalogProduct\)/u);
  assert.match(guide, /catalogItemId: defaultProduct\.id/u);
  assert.match(guide, /emptyLine\(crypto\.randomUUID\(\)\)/u);
});

test("editar una programación no iniciada exige motivo y vuelve a confirmación", async () => {
  const [sql, actions, drawer, editDialog] = await Promise.all([
    readFile(new URL(
      "../supabase/migrations/102_edit_unstarted_programming_with_reason.sql",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../src/features/programming/actions.ts", import.meta.url), "utf8"),
    readFile(new URL(
      "../src/features/programming/components/programming-preview-drawer.tsx",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../src/features/programming/components/programming-edit-dialog.tsx",
      import.meta.url,
    ), "utf8"),
  ]);

  assert.match(sql, /p_reason text/u);
  assert.match(sql, /status not in \('PENDING_CONFIRMATION', 'CONFIRMED'\)/u);
  assert.match(sql, /PROGRAMMING_EDIT_HAS_DISPATCHES/u);
  assert.match(sql, /status = 'PENDING_CONFIRMATION'/u);
  assert.match(sql, /confirmed_quantity = null/u);
  assert.match(sql, /confirmed_at = null/u);
  assert.match(sql, /confirmed_by = null/u);
  assert.match(sql, /snapshot_programming\([\s\S]*v_reason/u);
  assert.match(actions, /p_reason: reason/u);
  assert.match(drawer, /Editar programación/u);
  assert.match(editDialog, /Motivo de edición \*/u);
  assert.match(editDialog, /Guardar y enviar a confirmación/u);
});
