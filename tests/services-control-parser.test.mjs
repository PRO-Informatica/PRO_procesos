import assert from "node:assert/strict";
import test from "node:test";
import { detectVisionTemplate, parseVisionDocument } from "../src/features/vision-ocr/document-parser.ts";
import { parseControlGuide, parseGuideVariants } from "../src/features/vision-ocr/control-guide-parser.ts";
import { orientedGuideWords } from "../src/features/vision-ocr/complete-guide-parser.ts";
import { readServicesControlFields } from "../src/features/vision-ocr/services-control-parser.ts";

// Vision-shaped synthetic responses reproduce field associations from the
// supplied controls. They do not claim to validate handwriting recognition.
function control({ title = "CONTROL DE OPERACIONES", brand = "SERVITEC", orderLabel = "No. PEDIDO", rotation = 0,
  missingReal = false, missingOrder = false, badDate = false, truck = false, ambiguousReal = false, commercialCode = false, shifted = false } = {}) {
  const words = [];
  const add = (text, x, y, w = Math.max(.025, text.length * .006)) => words.push({ text, x, y, w, h: .015 });
  const phrase = (text, x, y) => { for (const token of text.split(" ")) { const w = token.length * .006; add(token, x, y, w); x += w + .005; } };
  phrase(brand, .04, .035); phrase(title, .29, .035); phrase("No.", .8, .035); add("03794", .85, .035);
  phrase("DÍA", .65, .11); phrase("MES", .77, .11); phrase("AÑO", .91, .11);
  add("14", .65, .145); add(badDate ? "ilegible" : "noviembre", .75, .145); add("2026", .90, .145);
  phrase("NOMBRE DEL CLIENTE", .03, .22); phrase("Grupo Profesionales en Proyectos", .25, .22);
  phrase("OBRA", .03, .27); phrase("Coatepeque", .10, .27);
  if (!missingOrder) { phrase(orderLabel, .65, .27); add("40", .86, .27); }
  phrase("DIRECCIÓN DE OBRA", .03, .32); phrase("Aldea Bethania", .25, .32);
  phrase("HORA PROGRAMADA", .03, .39); add("1:30am", .2, .39);
  phrase("HORA INICIO BOMBEO", .35, .39); add("2:00am", .54, .39);
  phrase("HORA FIN BOMBEO", .66, .39); add("8:20am", .85, .39);
  phrase("No. TUBOS", .03, .45); add("15", .17, .45);
  phrase("NÚMERO DEL EQUIPO", .5, .45); add("43", .85, .45);
  phrase("TIPO DE CONCRETO", .55, .51); add("CONF3001", .78, .51);
  phrase("VOLUMEN PROGRAMADO", .03, .57); add("14.50", .24, .57);
  phrase("VOLUMEN REAL", .46, .57); if (!missingReal) add("19,50", .64, .57);
  if (ambiguousReal) add("20.50", .76, .57);
  phrase("FLETE FALSO", .82, .57); add("NO", .95, .57);
  if (truck) {
    phrase("CAMIÓN", .03, .64); add("183", .17, .64);
    phrase("LLEGA A OBRA", .35, .64); add("7:50", .52, .64); add("p. m.", .57, .64);
    phrase("SALE DE OBRA", .03, .70); add("12:00am", .24, .70);
  }
  if (commercialCode) { phrase("CÓDIGO PRODUCTO", .03, .69); add("86131064", .25, .69); }
  phrase("OBSERVACIONES IMPORTANTES", .03, .77);
  phrase("Se fundieron columnas.", .03, .81); phrase("Se respetó la altura puesta en obra.", .03, .85);
  phrase("RECIBÍ CONFORME EL TRABAJO REALIZADO", .2, .92); phrase("Firma del encargado", .10, .97);
  if (shifted) for (const word of words) { word.x = .06 + word.x * .85; word.y = .025 + word.y * .90; word.w *= .85; word.h *= .90; }
  return response(words, rotation);
}

function response(words, rotation = 0) {
  const width = 1600, height = 2100;
  const rotate = ([x, y]) => rotation === 90 ? [height - y, x] : rotation === 180 ? [width - x, height - y] : rotation === 270 ? [y, width - x] : [x, y];
  return { responses: [{ fullTextAnnotation: { text: words.map((word) => word.text).join(" "), pages: [{
    width: rotation % 180 ? height : width, height: rotation % 180 ? width : height,
    blocks: [{ paragraphs: [{ words: words.map((word) => ({ confidence: .96, symbols: [...word.text].map((text) => ({ text })), boundingBox: {
      vertices: [[word.x * width, word.y * height], [(word.x + word.w) * width, word.y * height], [(word.x + word.w) * width, (word.y + word.h) * height], [word.x * width, (word.y + word.h) * height]]
        .map((point) => { const [x, y] = rotate(point); return { x, y }; }),
    } })) }] }],
  }] } }] };
}

test("clasifica primero la familia de control, con títulos alternos y cualquier proveedor", () => {
  for (const title of ["Pedido / control operación", "Pedido / control de operación", "Control de operaciones", "Control de operación", "Control operaciones", "Control de pedido", "Control de pedidos", "Pedido de control"]) {
    assert.equal(detectVisionTemplate(`SERVITEC\n${title}`), "PANEXUS_OPERATION", title);
    assert.equal(detectVisionTemplate(`MIXTO LISTO\n${title}`), "MIXTO_OPERATION", title);
  }
  assert.equal(detectVisionTemplate("CONCRET YSA REMISIÓN 002005 PEDIDO TOTAL 30"), null);
  assert.equal(detectVisionTemplate("No. de pedido 40"), null);
  assert.equal(detectVisionTemplate("MIXTO LISTO GUÍA DE DESPACHO No. 543"), "DISPATCH_GUIDE");
});

test("la marca debe estar en el encabezado y no en el cliente, cuadrilla u observaciones", () => {
  assert.equal(detectVisionTemplate("CONTROL DE OPERACIONES\nNOMBRE DEL CLIENTE: Mixto Listo"), "PANEXUS_OPERATION");
  assert.equal(detectVisionTemplate("SERVITEC CONTROL DE OPERACIONES\nGRUPO DE TRABAJO: Mixto Listo"), "PANEXUS_OPERATION");
  for (const rotation of [0, 90, 180, 270]) {
    const input = control({ brand: "MIXTO LISTO", rotation });
    assert.equal(detectVisionTemplate(input.responses[0].fullTextAnnotation.text, input), "MIXTO_OPERATION");
  }
});

test("SERVITEC: precarga folio, fecha, pedido, volumen real y observaciones sin asignar equipo o bombeo al camión", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const input = control({ rotation });
    const type = detectVisionTemplate(input.responses[0].fullTextAnnotation.text, input);
    assert.equal(type, "PANEXUS_OPERATION");
    const draft = parseControlGuide(input, type);
    assert.equal(draft.guideNumber, "03794");
    assert.equal(draft.details.guideDate, "2026-11-14");
    assert.equal(draft.details.orderNumber, "40");
    assert.equal(draft.lines[0].quantity, "19.50");
    assert.equal(draft.lines[0].type, "SERVICE"); assert.equal(draft.lines[0].unit, "M3");
    assert.equal(draft.lines[0].productCode, ""); assert.equal(draft.lines[0].catalogItemId, "");
    assert.equal(draft.lines[0].description, "");
    assert.equal(draft.details.truck, ""); assert.equal(draft.arrivalTime, ""); assert.equal(draft.departureTime, "");
    assert.equal(draft.details.observations, "Se fundieron columnas.\nSe respetó la altura puesta en obra.");
    assert.doesNotMatch(draft.details.observations, /FIRMA|Firma|CONFORME/);
    const document = parseVisionDocument(input, type, null);
    assert.equal(document.equipmentNumber, "43");
    assert.equal(document.pumpingStartTime, "2:00am"); assert.equal(document.pumpingEndTime, "8:20am");
  }
});

test("acepta las etiquetas comunes de pedido y posiciones diferentes sin usar una plantilla de proveedor", () => {
  for (const orderLabel of ["Pedido No.", "Número de pedido", "No. de pedido", "Código", "Código de pedido"]) {
    for (const shifted of [false, true]) {
      const draft = parseControlGuide(control({ title: "PEDIDO / CONTROL OPERACIÓN R-3", brand: "OTRO PROVEEDOR", orderLabel, shifted }), "PANEXUS_OPERATION");
      assert.equal(draft.details.orderNumber, "40", orderLabel);
      assert.equal(draft.details.guideDate, "2026-11-14"); assert.equal(draft.lines[0].quantity, "19.50");
    }
  }
});

test("Control de pedido No. conserva separado el folio del número de pedido", () => {
  for (const title of ["Control de pedido", "Control de pedidos", "Pedido de control", "Control de operaciones"]) {
    const draft = parseControlGuide(control({ title }), "PANEXUS_OPERATION");
    assert.equal(draft.guideNumber, "03794", title);
    assert.equal(draft.details.orderNumber, "40", title);
  }
});

test("solo precarga camión, llegada y salida cuando tienen etiquetas propias", () => {
  const draft = parseControlGuide(control({ truck: true }), "PANEXUS_OPERATION");
  assert.equal(draft.details.truck, "183"); assert.equal(draft.arrivalTime, "19:50"); assert.equal(draft.departureTime, "00:00");
  assert.equal(draft.details.loadingTime, "");
});

test("los campos ilegibles o ausentes quedan vacíos, sin tomar volumen programado, tubos ni equipo", () => {
  const draft = parseControlGuide(control({ missingReal: true, missingOrder: true, badDate: true }), "PANEXUS_OPERATION");
  assert.equal(draft.details.guideDate, ""); assert.equal(draft.details.orderNumber, ""); assert.equal(draft.lines[0].quantity, "");
  assert.match(draft.warnings.join(" "), /fecha/); assert.match(draft.warnings.join(" "), /pedido/); assert.match(draft.warnings.join(" "), /volumen real/);
});

test("no usa el código comercial como pedido ni elige entre dos volúmenes de la misma casilla", () => {
  const draft = parseControlGuide(control({ missingOrder: true, commercialCode: true, ambiguousReal: true }), "PANEXUS_OPERATION");
  assert.equal(draft.details.orderNumber, ""); assert.equal(draft.lines[0].quantity, "");
});

test("una fecha completa junto a FECHA funciona aunque no existan casillas Día/Mes/Año", () => {
  const input = response([
    { text: "FECHA:", x: .1, y: .2, w: .1, h: .02 },
    { text: "14/11/2026", x: .25, y: .2, w: .15, h: .02 },
  ]);
  assert.equal(readServicesControlFields(orientedGuideWords(input)).guideDate, "2026-11-14");
});

test("una fecha en observaciones o en la dirección no reemplaza una fecha de documento ausente", () => {
  for (const raw of ["CONTROL DE PEDIDO\nOBSERVACIONES\n14/11/2026", "CONTROL DE OPERACIONES\nDIRECCIÓN DE OBRA\n17/01\nAÑO\n2026"]) {
    assert.equal(readServicesControlFields([], raw).guideDate, "");
  }
});

test("conserva las variantes para corrección manual del tipo sin otra llamada OCR", () => {
  const variants = parseGuideVariants(control());
  assert.deepEqual(Object.keys(variants), ["DISPATCH_GUIDE", "MIXTO_OPERATION", "PANEXUS_OPERATION"]);
  assert.equal(variants.PANEXUS_OPERATION.guideNumber, "03794");
  assert.equal(variants.PANEXUS_OPERATION.details.documentType, "PANEXUS_OPERATION");
});
