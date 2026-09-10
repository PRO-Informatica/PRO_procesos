import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [dispatchWorkspace, dispatchDetail, guideDialog, programmingDetail, programmingPreview] =
  await Promise.all([
    readSource("../src/features/dispatches/components/dispatches-workspace.tsx"),
    readSource("../src/features/dispatches/components/dispatch-detail-view.tsx"),
    readSource("../src/features/dispatches/components/dispatch-guide-dialog.tsx"),
    readSource("../src/features/programming/components/programming-detail-view.tsx"),
    readSource("../src/features/programming/components/programming-preview-drawer.tsx"),
  ]);

test("Despachos separa la tabla de escritorio de las tarjetas móviles de guías", () => {
  assert.match(dispatchWorkspace, /hidden overflow-x-auto sm:block/u);
  assert.match(dispatchWorkspace, /divide-y divide-border sm:hidden/u);
  assert.match(dispatchWorkspace, /Fecha programada/u);
  assert.match(dispatchWorkspace, /Programación/u);
  assert.match(dispatchWorkspace, /Despacho/u);
});

test("el detalle de despacho conserva toda la información con jerarquía móvil", () => {
  assert.match(dispatchDetail, /min-\[420px\]:grid-cols-2/u);
  assert.match(dispatchDetail, /break-all font-semibold/u);
  assert.match(dispatchDetail, /sm:bg-transparent sm:p-0/u);
  assert.match(dispatchDetail, /Factura de producto/u);
  assert.match(dispatchDetail, /Factura de servicio/u);
});

test("el editor de guía adapta productos y acciones a pantallas pequeñas", () => {
  assert.match(guideDialog, /min-\[460px\]:grid-cols-2/u);
  assert.match(guideDialog, /min-\[460px\]:flex-row/u);
  assert.match(guideDialog, /min-h-11 w-full/u);
});

test("Programación ofrece acciones completas y despachos legibles en móvil", () => {
  assert.match(programmingDetail, /min-\[420px\]:grid-cols-2 sm:flex/u);
  assert.match(programmingDetail, /grid grid-cols-2 gap-3 px-4 py-4/u);
  assert.match(programmingDetail, /Estado del proceso/u);
  assert.match(programmingDetail, /Resultado físico/u);
  assert.match(programmingDetail, /Cantidad/u);
});

test("la vista previa de Programación evita truncar datos importantes", () => {
  assert.match(programmingPreview, /\[overflow-wrap:anywhere\]/u);
  assert.match(programmingPreview, /min-\[400px\]:grid-cols-2/u);
  assert.match(programmingPreview, /min-\[400px\]:flex-row/u);
});
