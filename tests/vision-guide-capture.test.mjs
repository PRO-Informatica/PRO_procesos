import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import { emptyGuideDetails, matchGuideCatalog, normalizeGuideDate, normalizeGuideTime, normalizeGuideUnit, validateOcrReview } from '../src/features/vision-ocr/guide-draft.ts';
import {parseCompleteGuide} from '../src/features/vision-ocr/complete-guide-parser.ts';
import {FULL_GUIDE_CROP, imageQuality, validGuideCrop} from '../src/features/vision-ocr/image-preparation.ts';

test('horarios: 12/24 horas, medianoche y datos ambiguos sin adivinar',()=>{
 for(const[raw,expected]of [['6 pm','18:00'],['6:15 p.m.','18:15'],['15:10','15:10'],['12 am','00:00'],['12 pm','12:00'],['03:20','03:20'],['8.25pm','20:25'],['15:00 pm','15:00'],['6',null],['25:00',null],['0 pm',null],['18 am',null],['1:10 PH',null],['6:99 am',null]])assert.equal(normalizeGuideTime(raw),expected,raw);
});
test('fechas se interpretan día/mes/año y no se corrigen fechas imposibles',()=>{
 assert.equal(normalizeGuideDate('11/2/2026'),'2026-02-11');assert.equal(normalizeGuideDate('02/11/26'),'2026-11-02');
 assert.equal(normalizeGuideDate('2026-10-29'),'2026-10-29');assert.equal(normalizeGuideDate('31/02/2026'),null);
 assert.equal(normalizeGuideDate('3 de noviembre de 2026'),'2026-11-03');assert.equal(normalizeGuideDate('3 noviembre 26'),'2026-11-03');assert.equal(normalizeGuideDate('03 / 11 / 26'),'2026-11-03');assert.equal(normalizeGuideDate('99/10/26'),null);
});
test('normaliza unidades usadas por las guías sin inventar conversiones',()=>{
 for(const [raw,value]of [['m³','M3'],['m²','M2'],['U','UN'],['Unitario','UN'],['ea','UN'],['dosis/m3','DOSIS/M3'],['desconocida','']])assert.equal(normalizeGuideUnit(raw),value);
});
const project={name:'Proyecto A',code:'PA',address:'1 calle 3-45 zona 1 Guatemala',additionalAddresses:['2 avenida 5-15 zona 4 Guatemala']};
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
 const draft={resident:{castingElement:'COLUMNS',laboratoryApplied:false},guideNumber:'QA-1',arrivalTime:'23:00',departureTime:'03:20',details:{...emptyGuideDetails(),projectName:'PA',workAddress:project.address,guideDate:'2026-10-29'},lines:[{...line,type:'SERVICE',unit:'UN',productCode:'UNKNOWN'}]};
 assert.equal(validateOcrReview(draft),null);
 for(const type of ['PRODUCT','SERVICE'])assert.equal(validateOcrReview({...draft,lines:[{...draft.lines[0],type,unit:''}]}),null);
 assert.match(validateOcrReview({...draft,resident:{castingElement:'',laboratoryApplied:false}}),/elemento/);
 assert.match(validateOcrReview({...draft,resident:{castingElement:'COLUMNS',laboratoryApplied:'yes'}}),/elemento/);
 assert.match(validateOcrReview({...draft,lines:[{...draft.lines[0],unit:'ma'}]}),/UM/);assert.match(validateOcrReview({...draft,lines:[{...draft.lines[0],quantity:'0'}]}),/cantidad/);
 assert.match(validateOcrReview({...draft,arrivalTime:'6 pm'}),/horas/);assert.match(validateOcrReview({...draft,details:{...draft.details,guideDate:'2026-02-31'}}),/fecha/);
});

function fixture(rotation=0, options={}){
 const words=[];
 const add=(text,x,y,w=.07)=>words.push({text,x,y,w,h:.018});
 const label=(text,x,y)=>{let current=x;for(const t of text.split(' ')){const w=t.length*.009;add(t,current,y,w);current+=w+.008;}};
 label('GUIA DE DESPACHO',.74,.05);add(options.guideNumber??'7145427',.81,.10,.12);
 label('NOMBRE DEL CLIENTE',.04,.18);label('GRUPO PROFESIONALES',.04,.22);
 label('PROYECTO',.04,.28);label('PROYECTO A',.04,.32);
 label('DIRECCION DE OBRA',.41,.18);label('1 CALLE 3-45 ZONA 1',.41,.22);
 label('FECHA',.82,.18);add(options.date??'29/10/26',.82,.22,.17);
 label('No. PEDIDO',.82,.28);add('147',.84,.32,.05);
 label('CANTIDAD',.04,.39);label('UM',.17,.39);label('CODIGO PRODUCTO',.25,.39);label('DESCRIPCION PRODUCTO',.46,.39);
 const lines=options.lines??[{quantity:'7.00',unit:'m3',code:'86131064',description:'CONF4001'},{quantity:'1.00',unit:'UN',code:'SERV1',description:'BOMBA OPERADOR'}];
 for(const[lineIndex,line]of lines.entries()){
  const y=.44+lineIndex*.065;
  if(line.quantity)add(line.quantity,.06,y,.06);
  if(line.unit)add(line.unit,.17,y,.04);
  add(line.code,.25,y,.10);label(line.description,.40,y);
  if(line.continuation)label(line.continuation,.40,y+.035);
 }
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

test('la inclinación no separa la cantidad de su código ni pierde la primera fila',()=>{
 const response=fixture(),angle=4*Math.PI/180;
 for(const w of response.responses[0].fullTextAnnotation.pages[0].blocks[0].paragraphs[0].words){
  w.boundingBox.vertices=w.boundingBox.vertices.map(({x,y})=>({x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)}));
 }
 const draft=parseCompleteGuide(response);
 assert.deepEqual(draft.lines.map(l=>[l.quantity,l.productCode]),[['7.00','86131064'],['1.00','SERV1']]);
 assert.equal(draft.details.guideDate,'2026-10-29');
});

test('fecha escrita y horas siguen su columna; el pie de página no se vuelve observación',()=>{
 const response=fixture(0,{date:'3 de noviembre de 26'});
 const paragraphs=response.responses[0].fullTextAnnotation.pages[0].blocks[0].paragraphs;
 const word=(text,x,y,w=.09)=>({symbols:[...text].map(text=>({text})),boundingBox:{vertices:[{x:x*1200,y:y*1600},{x:(x+w)*1200,y:y*1600},{x:(x+w)*1200,y:(y+.018)*1600},{x:x*1200,y:(y+.018)*1600}]}});
 paragraphs.push({words:[word('ORIGINAL',.4,.925),word('DUPLICADO',.54,.925),word('ROSADO',.66,.925)]});
 const draft=parseCompleteGuide(response);assert.equal(draft.details.guideDate,'2026-11-03');assert.equal(draft.details.observations,'Revisar acceso');
});
// Manually transcribed lines from the supplied sample; synthetic coordinates,
// not a claim about Google Vision accuracy on the original photographs.
test('guía mixta conserva producto y cuatro servicios, incluido código numérico y última descripción extendida',()=>{
 const sample=[
  {quantity:'6.50',unit:'m³',code:'86131064',description:'CONF4001'},
  {quantity:'1.00',unit:'',code:'SERV0507',description:'BOMBA + OPERADOR REG'},
  {quantity:'1.00',unit:'',code:'SERV0510',description:'Colocación región'},
  {quantity:'13.00',unit:'um',code:'SERV1014',description:'TUBO ADICIONAL'},
  {quantity:'1.00',unit:'m³',code:'6009002',description:'SERVICIO DE BOMBA',continuation:'ESTACIONARIA'},
 ];
 for(const rotation of [0,90,180]){
  const result=parseCompleteGuide(fixture(rotation,{guideNumber:'6015-000543',date:'3 de noviembre de 2026',lines:sample}));
  assert.equal(result.guideNumber,'6015-000543');assert.equal(result.details.guideDate,'2026-11-03');
  assert.deepEqual(result.lines.map(l=>l.productCode),sample.map(l=>l.code));
  assert.deepEqual(result.lines.map(l=>l.quantity),['6.50','1.00','1.00','13.00','1.00']);
  assert.equal(result.lines.filter(l=>l.type==='SERVICE').length,4);
  assert.equal(result.lines.at(-1).description,'SERVICIO DE BOMBA ESTACIONARIA');
 }
});
test('cada fotografía conserva su número y líneas; una guía de producto no hereda los servicios de otra',()=>{
 const result=parseCompleteGuide(fixture(90,{guideNumber:'6015-000544',lines:[{quantity:'7.50',unit:'m3',code:'86131064',description:'CONF4001'}]}));
 assert.equal(result.guideNumber,'6015-000544');assert.equal(result.lines.length,1);assert.equal(result.lines[0].quantity,'7.50');
});
test('no elimina servicios con cantidad ilegible ni une códigos repetidos en la tabla',()=>{
 const result=parseCompleteGuide(fixture(0,{lines:[
  {quantity:'6.50',unit:'m3',code:'86131064',description:'CONF4001'},
  {quantity:'',unit:'UN',code:'SERV0507',description:'BOMBA'},
  {quantity:'2.00',unit:'UN',code:'SERV0507',description:'OTRA VARIANTE'},
 ]}));
 assert.equal(result.lines.length,3);assert.equal(result.lines[1].quantity,'');
 assert.match(result.warnings.join(' '),/no se leyó la cantidad/);
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
 assert.match(server,/hasValidSameOrigin/);assert.match(server,/getClaims/);assert.match(server,/context.activeProject\?\.id !== projectId/);assert.doesNotMatch(server,/guideIdentity/);
 assert.match(sql,/capture\.guide_id is not null/);assert.match(sql,/OCR_CATALOG_VARIANT_REQUIRED/);assert.match(sql,/grant select on public\.guide_ocr_captures to authenticated/);
 assert.doesNotMatch(sql,/grant (?:all|update|insert).* to authenticated/);
});

test('UM ilegible o ausente queda vacía sin advertencia ni valor impuesto por catálogo',()=>{
 for(const unit of ['', 'ma']){const draft=parseCompleteGuide(fixture(0,{lines:[{quantity:'6.50',unit,code:product.code,description:'CONF4001'}]}));assert.equal(draft.lines[0].unit,'');assert.ok(!draft.warnings.some(w=>/confirma la UM/.test(w)));assert.equal(matchGuideCatalog(draft.lines[0],[product],'M3').unit,'');}
 assert.equal(matchGuideCatalog({...line,productCode:'SERV1',unit:''},[service],'M3').unit,'');
});
