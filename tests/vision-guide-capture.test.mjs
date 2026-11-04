import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import { emptyGuideDetails, guideIdentity, matchGuideCatalog, normalizeGuideDate, normalizeGuideTime, normalizeGuideUnit, validateOcrReview } from '../src/features/vision-ocr/guide-draft.ts';
import {parseCompleteGuide} from '../src/features/vision-ocr/complete-guide-parser.ts';
import {FULL_GUIDE_CROP, imageQuality, validGuideCrop} from '../src/features/vision-ocr/image-preparation.ts';

test('horarios: 12/24 horas, medianoche y datos ambiguos sin adivinar',()=>{
 for(const[raw,expected]of [['6 pm','18:00'],['6:15 p.m.','18:15'],['15:10','15:10'],['12 am','00:00'],['12 pm','12:00'],['03:20','03:20'],['6',null],['25:00',null],['0 pm',null],['18 pm',null],['6:99 am',null]])assert.equal(normalizeGuideTime(raw),expected,raw);
});
test('fechas se interpretan día/mes/año y no se corrigen fechas imposibles',()=>{
 assert.equal(normalizeGuideDate('11/2/2026'),'2026-02-11');assert.equal(normalizeGuideDate('02/11/26'),'2026-11-02');
 assert.equal(normalizeGuideDate('2026-10-29'),'2026-10-29');assert.equal(normalizeGuideDate('31/02/2026'),null);
});
test('normaliza unidades usadas por las guías sin inventar conversiones',()=>{
 for(const [raw,value]of [['m³','M3'],['m²','M2'],['U','UN'],['Unitario','UN'],['ea','UN'],['dosis/m3','DOSIS/M3'],['desconocida','']])assert.equal(normalizeGuideUnit(raw),value);
});
const project={name:'Proyecto A',code:'PA',address:'1 calle 3-45 zona 1 Guatemala',additionalAddresses:['2 avenida 5-15 zona 4 Guatemala']};
test('identidad solo valida proyecto y cualquiera de sus direcciones; no valida pedido ni cliente',()=>{
 const details={...emptyGuideDetails(),projectName:'PROYECTO A',workAddress:'2 avenida 5-15 zona 4 Guatemala',orderNumber:'999',customerName:'Nombre diferente'};
 assert.equal(guideIdentity(project,details).matches,true);
 assert.equal(guideIdentity(project,{...details,workAddress:'2 avenida 5-16 zona 4 Guatemala'}).matches,false);
 assert.equal(guideIdentity(project,{...details,projectName:'Proyecto B'}).matches,false);
 assert.equal(guideIdentity(project,{...details,projectName:'PA'}).matches,true);
});
const line={quantity:'7',unit:'M3',productCode:'86131064',description:'Texto OCR',type:'',catalogItemId:'',candidates:[],warning:null};
const product={id:'product',type:'PRODUCT',code:'86131064',reference:'CONF4001',description:null,observations:null,unitCode:null,price:1224.16,currency:'GTQ'};
const service={...product,id:'service',type:'SERVICE',code:'SERV1',reference:null,description:'Bomba',unitCode:'UN',observations:'Volumen menor a 6',price:100};
test('código exacto toma precio y referencia del catálogo del proyecto',()=>{
 const result=matchGuideCatalog(line,[product],'M3');assert.equal(result.catalogItemId,'product');assert.equal(result.description,'CONF4001');assert.equal(result.candidates[0].price,1224.16);
 assert.equal(matchGuideCatalog({...line,productCode:'8613106'},[product],'M3').catalogItemId,'');
});
test('servicios repetidos exigen variante: nunca elegir un precio arbitrariamente ni copiar observaciones',()=>{
 const result=matchGuideCatalog({...line,productCode:'SERV1'},[service,{...service,id:'variant',price:200,observations:'Otro caso'}],'M3');
 assert.equal(result.catalogItemId,'');assert.equal(result.candidates.length,2);assert.equal(result.type,'SERVICE');assert.match(result.warning,/varias opciones/);
 const unique=matchGuideCatalog({...line,productCode:'SERV1'},[service],'M3');assert.equal(unique.description,'Bomba');assert.equal(unique.unit,'UN');assert.ok(!unique.description.includes(service.observations));
});
test('código desconocido conserva campos; sin precio falso ni selección de otro proyecto',()=>{
 const result=matchGuideCatalog({...line,productCode:'NO-EXISTE'},[],'M3');assert.equal(result.catalogItemId,'');assert.equal(result.candidates.length,0);assert.equal(result.description,'Texto OCR');assert.match(result.warning,/precio pendiente/);
});
test('revisión permite líneas sin catálogo y guías solo de servicios; exige campos operativos válidos',()=>{
 const draft={guideNumber:'QA-1',arrivalTime:'23:00',departureTime:'03:20',details:{...emptyGuideDetails(),projectName:'PA',workAddress:project.address,guideDate:'2026-10-29'},lines:[{...line,type:'SERVICE',unit:'UN',productCode:'UNKNOWN'}]};
 assert.equal(validateOcrReview(draft),null);assert.match(validateOcrReview({...draft,lines:[{...draft.lines[0],quantity:'0'}]}),/cantidad/);
 assert.match(validateOcrReview({...draft,arrivalTime:'6 pm'}),/horas/);assert.match(validateOcrReview({...draft,details:{...draft.details,guideDate:'2026-02-31'}}),/fecha/);
});

function fixture(rotation=0){
 const words=[];
 const add=(text,x,y,w=.07)=>words.push({text,x,y,w,h:.018});
 const label=(text,x,y)=>{let current=x;for(const t of text.split(' ')){const w=t.length*.009;add(t,current,y,w);current+=w+.008;}};
 label('GUIA DE DESPACHO',.74,.05);add('7145427',.81,.10,.12);
 label('NOMBRE DEL CLIENTE',.04,.18);label('GRUPO PROFESIONALES',.04,.22);
 label('PROYECTO',.04,.28);label('PROYECTO A',.04,.32);
 label('DIRECCION DE OBRA',.41,.18);label('1 CALLE 3-45 ZONA 1',.41,.22);
 label('FECHA',.82,.18);add('29/10/26',.82,.22,.12);
 label('No. PEDIDO',.82,.28);add('147',.84,.32,.05);
 label('CANTIDAD',.04,.39);label('UM',.17,.39);label('CODIGO PRODUCTO',.25,.39);label('DESCRIPCION PRODUCTO',.46,.39);
 add('7.00',.06,.44,.06);add('m3',.17,.44,.04);add('86131064',.25,.44,.10);add('CONF4001',.40,.44,.12);
 add('1.00',.06,.49,.06);add('UN',.17,.49,.04);add('SERV1',.25,.49,.07);label('BOMBA OPERADOR',.40,.49);
 label('PLANTA',.79,.39);add('CAMION',.90,.39,.08);add('QU',.80,.44,.04);add('0186',.91,.44,.06);
 label('HORA CARGA',.79,.50);add('15:10',.84,.55,.08);
 label('LLEGA OBRA',.79,.61);add('6',.80,.66,.02);add('pm',.84,.66,.03);
 label('SALE OBRA',.79,.72);add('03:20',.84,.77,.08);
 label('PILOTO',.04,.85);label('JUAN PEREZ',.04,.89);
 label('OPERADOR',.04,.93);add('0079',.14,.93,.06);
 label('OBSERVACIONES',.32,.85);label('Revisar acceso',.32,.89);
 const width=1200,height=1600;
 const rotate=([x,y])=>rotation===90?[height-y,x]:rotation===180?[width-x,height-y]:[x,y];
 return {responses:[{fullTextAnnotation:{pages:[{width:rotation===90?height:width,height:rotation===90?width:height,blocks:[{paragraphs:[{words:words.map(w=>({confidence:.96,symbols:[...w.text].map(text=>({text})),boundingBox:{vertices:[[w.x*width,w.y*height],[(w.x+w.w)*width,w.y*height],[(w.x+w.w)*width,(w.y+w.h)*height],[w.x*width,(w.y+w.h)*height]].map(p=>{const[x,y]=rotate(p);return{x,y};})}}))}]}]}]}}]};
}
test('parser ordena los 18 campos con columnas ancladas en encabezados, sin porcentajes fijos de foto',()=>{
 const result=parseCompleteGuide(fixture());
 assert.equal(result.guideNumber,'7145427');assert.equal(result.details.projectName,'PROYECTO A');assert.equal(result.details.customerName,'GRUPO PROFESIONALES');
 assert.equal(result.details.guideDate,'2026-10-29');assert.equal(result.details.orderNumber,'147');
 assert.equal(result.details.plant,'QU');assert.equal(result.details.truck,'0186');assert.equal(result.details.pilot,'JUAN PEREZ');assert.equal(result.details.operator,'0079');
 assert.equal(result.details.loadingTime,'15:10');assert.equal(result.arrivalTime,'18:00');assert.equal(result.departureTime,'03:20');assert.equal(result.details.observations,'Revisar acceso');
 assert.equal(result.lines.length,2);assert.equal(result.lines[0].description,'CONF4001');assert.equal(result.lines[1].productCode,'SERV1');
});
test('orientación de Vision se corrige para fotos giradas sin cambiar código ni ceros del camión',()=>{
 for(const rotation of [90,180]){const result=parseCompleteGuide(fixture(rotation));assert.equal(result.guideNumber,'7145427');assert.equal(result.details.truck,'0186');assert.equal(result.lines[0].productCode,'86131064');}
});
test('lectura vacía advierte sin inventar campos ni fechas',()=>{
 const result=parseCompleteGuide({responses:[{}]});assert.equal(result.guideNumber,'');assert.equal(result.details.guideDate,'');assert.equal(result.lines.length,0);assert.ok(result.warnings.length>0);
});
test('recorte rechaza esquinas cruzadas, fuera de imagen y un documento demasiado pequeño',()=>{
 assert.equal(validGuideCrop(FULL_GUIDE_CROP),true);assert.equal(validGuideCrop([FULL_GUIDE_CROP[0],FULL_GUIDE_CROP[2],FULL_GUIDE_CROP[1],FULL_GUIDE_CROP[3]]),false);
 assert.equal(validGuideCrop([{x:-.1,y:0},...FULL_GUIDE_CROP.slice(1)]),false);
 assert.equal(validGuideCrop([{x:0,y:0},{x:.1,y:0},{x:.1,y:.1},{x:0,y:.1}]),false);
});
test('calidad advierte foto pequeña, sin contraste y desenfocada; no inventa texto',()=>{
 const quality=imageQuality(new Uint8ClampedArray(100*100*4).fill(250),100,100);assert.equal(quality.warnings.length,3);
});
test('límites DEV y contrato de guardado aíslan PROD y no debilitan captura manual',async()=>{
 const server=await readFile('src/features/vision-ocr/capture-server.ts','utf8');const sql=await readFile('supabase/migrations/131_vision_ocr_guide_capture.sql','utf8');
 assert.match(server,/appEnvironment !== "DEV"/);assert.match(server,/projectRef !== "gholwtklihaphoevosyb"/);assert.doesNotMatch(server,/jeyjblxfqqlypxiaznad/);
 assert.match(server,/hasValidSameOrigin/);assert.match(server,/getClaims/);assert.match(server,/guideIdentity/);
 assert.match(sql,/capture\.guide_id is not null/);assert.match(sql,/OCR_CATALOG_VARIANT_REQUIRED/);assert.match(sql,/grant select on public\.guide_ocr_captures to authenticated/);
 assert.doesNotMatch(sql,/grant (?:all|update|insert).* to authenticated/);
});
