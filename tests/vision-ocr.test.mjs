import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildVisionRequestBody,
  extractVisionText,
  hasValidImageSignature,
  isAllowedVisionImageType,
  VISION_OCR_ENDPOINT,
  VISION_OCR_MAX_BYTES,
} from "../src/features/vision-ocr/vision-ocr.ts";
import { parseDispatchGuideWords } from "../src/features/vision-ocr/guide-parser.ts";
import { detectVisionTemplate } from "../src/features/vision-ocr/document-parser.ts";
import { parseMixtoOperationWords, parsePanexusOperationWords } from "../src/features/vision-ocr/operation-parser.ts";
import { classifyTemplatePixels } from "../src/features/vision-ocr/template-classifier.ts";

const route = await readFile(new URL("../src/app/api/vision-ocr/route.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/features/vision-ocr/service.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("../src/features/vision-ocr/components/vision-ocr-workspace.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/(dashboard)/vision-ocr/page.tsx", import.meta.url), "utf8");

test("acepta únicamente los tipos de imagen aprobados", () => {
  assert.equal(isAllowedVisionImageType("image/jpeg"), true);
  assert.equal(isAllowedVisionImageType("image/png"), true);
  assert.equal(isAllowedVisionImageType("image/webp"), true);
  assert.equal(isAllowedVisionImageType("image/gif"), false);
  assert.equal(isAllowedVisionImageType("application/pdf"), false);
});

test("valida firmas JPEG, PNG y WEBP", () => {
  assert.equal(hasValidImageSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"), true);
  assert.equal(hasValidImageSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), true);
  assert.equal(hasValidImageSignature(new TextEncoder().encode("RIFF0000WEBP"), "image/webp"), true);
  assert.equal(hasValidImageSignature(new TextEncoder().encode("not an image"), "image/png"), false);
});

test("construye exclusivamente DOCUMENT_TEXT_DETECTION con contenido Base64", () => {
  assert.deepEqual(buildVisionRequestBody("YWJj"), {
    requests: [{ image: { content: "YWJj" }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }],
  });
});

test("conserva exactamente el texto de fullTextAnnotation", () => {
  const detected = " Línea uno  \nLínea dos\n";
  assert.deepEqual(extractVisionText({ responses: [{ fullTextAnnotation: { text: detected } }] }), {
    error: false,
    text: detected,
  });
  assert.deepEqual(extractVisionText({ responses: [{}] }), { error: false, text: "" });
  assert.deepEqual(extractVisionText({ responses: [{ error: { code: 3 } }] }), { error: true });
});

test("la integración mantiene la clave exclusivamente en header del servidor", () => {
  assert.equal(VISION_OCR_ENDPOINT, "https://vision.googleapis.com/v1/images:annotate");
  assert.equal(VISION_OCR_MAX_BYTES, 7 * 1024 * 1024);
  assert.match(service, /process\.env\.GOOGLE_VISION_API_DEV_KEY/u);
  assert.match(service, /"x-goog-api-key": apiKey/u);
  assert.doesNotMatch(service, /\?key=/u);
  assert.doesNotMatch(workspace, /GOOGLE_VISION_API_DEV_KEY|x-goog-api-key|NEXT_PUBLIC_/u);
});

test("el endpoint exige sesión activa, mismo origen y evita cache", () => {
  assert.match(route, /appEnvironment !== "DEV"/u);
  assert.match(page, /appEnvironment !== "DEV"/u);
  assert.match(route, /hasValidSameOrigin/u);
  assert.match(route, /auth\.getClaims/u);
  assert.match(route, /\.from\("profiles"\)/u);
  assert.match(route, /"Cache-Control": "private, no-store"/u);
  assert.match(route, /formData\.get\("image"\)/u);
});

test("la interfaz limpia object URLs y presenta el resultado estructurado sin persistirlo", () => {
  assert.match(workspace, /URL\.createObjectURL/u);
  assert.match(workspace, /URL\.revokeObjectURL/u);
  assert.match(workspace, /setText\(payload\.text\)/u);
  assert.match(workspace, /setDocument\(payload\.document\)/u);
  assert.match(workspace, /Datos generales/u);
  assert.match(workspace, /Código producto/u);
  assert.doesNotMatch(workspace, /programming|createProgramming|from\("program/u);
});

test("ordena los campos y productos según la plantilla de guía", () => {
  const word = (text, xStart, yStart, xEnd = xStart + 0.04, yEnd = yStart + 0.018) => ({ text, xStart, xEnd, yStart, yEnd });
  const words = [
    word("NOMBRE", 0.04, 0.15), word("DEL", 0.10, 0.15), word("CLIENTE:", 0.14, 0.15),
    word("GRUPO", 0.05, 0.19), word("PROFESIONALES", 0.11, 0.19), word("EN", 0.23, 0.19), word("PROYECTOS", 0.27, 0.19),
    word("PROYECTO:", 0.04, 0.24), word("CASA", 0.05, 0.28), word("SALAMÁ", 0.10, 0.28),
    word("DIRECCIÓN", 0.43, 0.15), word("DE", 0.52, 0.15), word("OBRA:", 0.56, 0.15),
    word("CALLE", 0.44, 0.20), word("DEL", 0.50, 0.20), word("HOSPITAL", 0.54, 0.20),
    word("EL", 0.44, 0.24), word("CALVARIO", 0.48, 0.24),
    word("GUÍA", 0.76, 0.05), word("DE", 0.82, 0.05), word("DESPACHO", 0.85, 0.05), word("No.", 0.78, 0.11), word("10518027", 0.85, 0.11),
    word("No.", 0.80, 0.22), word("PEDIDO", 0.84, 0.22), word("174", 0.85, 0.28),
    word("CANTIDAD", 0.05, 0.36), word("UM", 0.16, 0.36), word("CÓDIGO", 0.25, 0.36), word("PRODUCTO", 0.31, 0.36), word("DESCRIPCIÓN", 0.48, 0.36), word("PRODUCTO", 0.59, 0.36),
    word("5.50", 0.07, 0.42), word("m3", 0.16, 0.42), word("86131029", 0.25, 0.42), word("CON.3001", 0.48, 0.42),
    word("PBX", 0.021, 0.455, 0.033),
    word("2.00", 0.07, 0.46), word("ea", 0.16, 0.46), word("SERV0226", 0.25, 0.46), word("DOSIS", 0.48, 0.46), word("RETARDANTE", 0.54, 0.46),
    word("FORMULARIOS", 0.012, 0.49, 0.035),
    word("PILOTO:", 0.04, 0.75), word("OBSERVACIONES:", 0.31, 0.75),
  ];

  assert.deepEqual(parseDispatchGuideWords(words), {
    customerName: "GRUPO PROFESIONALES EN PROYECTOS",
    projectName: "CASA SALAMÁ",
    workAddress: "CALLE DEL HOSPITAL EL CALVARIO",
    dispatchGuideNumber: "10518027",
    orderNumber: "174",
    items: [
      { quantity: "5.50", unit: "m3", productCode: "86131029", description: "CON.3001" },
      { quantity: "2.00", unit: "ea", productCode: "SERV0226", description: "DOSIS RETARDANTE" },
    ],
    warnings: [],
  });
});

test("marca campos faltantes sin inventar valores", () => {
  const parsed = parseDispatchGuideWords([]);
  assert.equal(parsed.customerName, null);
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.warnings.length, 2);
  assert.match(parsed.warnings[0], /nombre del cliente/u);
});

test("identifica las tres plantillas localmente antes de enviar la imagen", () => {
  const pixels = (width, height, redHeader = false) => {
    const data = new Uint8ClampedArray(width * height * 4).fill(245);
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
    if (redHeader) {
      for (let y = 0; y < Math.floor(height * 0.2); y += 1) {
        for (let x = 0; x < Math.floor(width * 0.25); x += 1) {
          const offset = (y * width + x) * 4;
          data[offset] = 180; data[offset + 1] = 25; data[offset + 2] = 25;
        }
      }
    }
    return { data, width, height };
  };
  assert.equal(classifyTemplatePixels(pixels(600, 350)).templateType, "DISPATCH_GUIDE");
  assert.equal(classifyTemplatePixels(pixels(500, 600, true)).templateType, "MIXTO_OPERATION");
  assert.equal(classifyTemplatePixels(pixels(500, 600)).templateType, "PANEXUS_OPERATION");
  assert.match(workspace, /analyzeVisionTemplate\(next\)/u);
  assert.match(workspace, /formData\.set\("templateType"/u);
  assert.match(route, /isVisionTemplateType/u);
});

test("confirma la plantilla usando los encabezados devueltos por Vision", () => {
  assert.equal(detectVisionTemplate("MIXTO LISTO\nPEDIDO / CONTROL OPERACION"), "MIXTO_OPERATION");
  assert.equal(detectVisionTemplate("PANEXUS\nPEDIDO / CONTROL OPERACION R-3"), "PANEXUS_OPERATION");
  assert.equal(detectVisionTemplate("GUIA DE DESPACHO\nNo. 10518027"), "DISPATCH_GUIDE");
  assert.equal(detectVisionTemplate("documento desconocido"), null);
  assert.equal(detectVisionTemplate([
    "MIXTO LISTO",
    "PEDIDO / CONTROL OPERACIÓN",
    "CURADO POR MIXTO LISTO SI NO",
    "TUBERIA DEJADA EN OBRA",
    "GRUPO DE TRABAJO: Panexus / Miguel",
  ].join("\n")), "MIXTO_OPERATION");
});

test("ordena los campos requeridos del control de operación Mixto Listo", () => {
  const word = (text, xStart, yStart, xEnd = xStart + 0.04, yEnd = yStart + 0.01) => ({ text, xStart, xEnd, yStart, yEnd });
  const words = [
    word("GUATEMALA", .44, .10), word("18", .54, .10), word("Septiembre", .65, .10), word("2026", .91, .10),
    word("PEDIDO", .03, .17), word("POR:", .09, .17), word("GRUPO", .17, .17), word("PROFESIONALES", .24, .17),
    word("PEDIDO", .70, .23), word("No.", .78, .23), word("132", .86, .23),
    word("EQUIPO:", .03, .38), word("BOMBA", .15, .38), word("No:", .39, .38), word("59", .47, .38),
    word("TIPO", .63, .43), word("DE", .68, .43), word("CONCRETO:", .72, .43), word("CONF5000", .86, .43),
    word("VOLUMEN", .03, .48), word("ESTIMADO:", .12, .48), word("13", .30, .48),
    word("VOLUMEN", .44, .48), word("REAL:", .53, .48), word("13", .62, .48),
  ];
  const parsed = parseMixtoOperationWords(words, false);
  assert.equal(parsed.templateType, "MIXTO_OPERATION");
  assert.equal(parsed.date, "18/09/2026");
  assert.equal(parsed.orderedBy, "GRUPO PROFESIONALES");
  assert.equal(parsed.orderNumber, "132");
  assert.equal(parsed.equipmentNumber, "59");
  assert.equal(parsed.concreteType, "CONF5000");
  assert.equal(parsed.estimatedVolume, "13");
  assert.equal(parsed.realVolume, "13");
  assert.equal(parsed.curedByMixto, false);
});

test("ordena Panexus y conserva las observaciones manuscritas del OCR", () => {
  const word = (text, xStart, yStart, xEnd = xStart + 0.04, yEnd = yStart + 0.01) => ({ text, xStart, xEnd, yStart, yEnd });
  const words = [
    word("CODIGO:", .70, .15), word("732", .80, .15),
    word("HORA", .03, .29), word("DE", .08, .29), word("INICIO", .12, .29), word("BOMBEO:", .19, .29), word("9:15", .31, .29),
    word("HORA", .48, .29), word("FINALIZACION", .54, .29), word("BOMBEO:", .68, .29), word("4:40", .80, .29), word("PM", .87, .29),
    word("EQUIPO:", .03, .34), word("BOMBA", .15, .34), word("No:", .39, .34), word("59", .47, .34),
    word("TIPO", .63, .39), word("DE", .68, .39), word("CONCRETO:", .72, .39), word("CONF5000", .86, .39),
    word("VOLUMEN", .03, .44), word("ESTIMADO:", .12, .44), word("96.50", .30, .44),
    word("VOLUMEN", .44, .44), word("REAL:", .53, .44), word("44.50", .62, .44),
    word("OBSERVACIONES:", .03, .66), word("Durante", .20, .66), word("la", .29, .66), word("fundición", .33, .66),
    word("se", .04, .70), word("respetó", .09, .70), word("el", .18, .70), word("nivel", .23, .70),
    word("RECIBÍ", .35, .84), word("CONFORME", .43, .84),
  ];
  const parsed = parsePanexusOperationWords(words, "GUATEMALA, 18\n18/09\nAÑO\n2026");
  assert.equal(parsed.templateType, "PANEXUS_OPERATION");
  assert.equal(parsed.date, "18/09/2026");
  assert.equal(parsed.code, "732");
  assert.equal(parsed.pumpingStartTime, "9:15");
  assert.equal(parsed.pumpingEndTime, "4:40 PM");
  assert.equal(parsed.equipmentNumber, "59");
  assert.equal(parsed.concreteType, "CONF5000");
  assert.equal(parsed.estimatedVolume, "96.50");
  assert.equal(parsed.realVolume, "44.50");
  assert.equal(parsed.observations, "Durante la fundición se respetó el nivel");
});

test("reconstruye fecha y campos Panexus aunque Vision altere el orden de lectura", () => {
  const raw = [
    "PEDIDO/CONTROL OPERACION R-3",
    "GUATEMALA, 18",
    "18/09",
    "HORA DE INICIO DE BOMBEO: 9:75",
    "MES",
    "No 11164",
    "No: 59",
    "AÑO",
    "2026",
    "MUROYSapatos / Based Plama TPO DE CONCRETO CONF 5007- CON 400",
  ].join("\n");
  const parsed = parsePanexusOperationWords([], raw);
  assert.equal(parsed.date, "18/09/2026");
  assert.equal(parsed.pumpingStartTime, "9:75");
  assert.equal(parsed.equipmentNumber, "59");
  assert.equal(parsed.concreteType, "CONF 5007- CON 400");
});

test("normaliza el mes manuscrito de Mixto sin mezclar Pedido por ni R.C.", () => {
  const raw = [
    "15 Avenida 17-01, ZONA 6",
    "PEDIDO / CONTROL OPERACION",
    "DIA",
    "GUATEMALA, 18",
    "retien bre",
    "PEDIDO POR: GRUPO PROFESIONALES EN PROYECTOS S.A.",
    "AÑO",
    "26",
    "R.C.#",
  ].join("\n");
  const parsed = parseMixtoOperationWords([], false, raw);
  assert.equal(parsed.date, "18/09/2026");
  assert.notEqual(parsed.date, "17/01/2026");
  assert.doesNotMatch(parsed.date, /PEDIDO|R\.C/u);
});
