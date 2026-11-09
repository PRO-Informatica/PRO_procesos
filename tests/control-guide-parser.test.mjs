import assert from 'node:assert/strict';
import test from 'node:test';
import {parseControlGuide,parseGuideVariants} from '../src/features/vision-ocr/control-guide-parser.ts';
import {normalizeCastingElement} from '../src/features/dispatches/casting-elements.ts';
import {emptyGuideDetails,matchGuideCatalog,validateOcrReview} from '../src/features/vision-ocr/guide-draft.ts';

// Synthetic coordinates follow the two supplied paper layouts. These tests
// verify association rules, not the OCR accuracy of handwritten photographs.
function fixture(panexus=false,rotation=0,{badMonth=false,missingVolume=false}={}) {
 const words=[];
 const add=(text,x,y,w=.04)=>words.push({text,x,y,w,h:.018});
 const label=(text,x,y)=>{for(const t of text.split(' ')){const w=t.length*.008;add(t,x,y,w);x+=w+.006;}};
 label('PEDIDO / CONTROL OPERACION',.35,.04);add(panexus?'12082':'349463',.85,.04,.10);
 label('DIA',.46,.10);add('03',.41,.12);label('MES',.7,.10);add(badMonth?'72':panexus?'11':'Noviembre',.60,.12,.12);label('AÑO',.9,.10);add(panexus?'2026':'26',.91,.12,.06);
 label(panexus?'CODIGO':'PEDIDO No.',.72,.25);add('88',.85,.25);
 label('HORA INICIO BOMBEO',.04,.40);add('7:50pm',.31,.40,.10);
 label('HORA FINALIZACION BOMBEO',.52,.40);add('12:00am',.85,.40,.10);
 label('EQUIPO No.',.04,.45);add('63',.3,.45);
 label('VOLUMEN ESTIMADO',.04,.53);add('24',.26,.53);
 label('VOLUMEN REAL',.45,.53);if(!missingVolume)add('14',.62,.53);
 label('OBSERVACIONES',.04,.76);label('Se uso tuberia normal',.25,.76);label('No hubo necesidad de tuberia adicional',.06,.80);
 label('RECIBI CONFORME',.3,.88);label('FIRMA OBRA',.6,.96);
 const width=1500,height=2100;
 const rotate=([x,y])=>rotation===90?[height-y,x]:rotation===180?[width-x,height-y]:rotation===270?[y,width-x]:[x,y];
 return{responses:[{fullTextAnnotation:{pages:[{width:rotation%180?height:width,height:rotation%180?width:height,blocks:[{paragraphs:[{words:words.map(w=>({confidence:.96,symbols:[...w.text].map(text=>({text})),boundingBox:{vertices:[[w.x*width,w.y*height],[(w.x+w.w)*width,w.y*height],[(w.x+w.w)*width,(w.y+w.h)*height],[w.x*width,(w.y+w.h)*height]].map(p=>{const[x,y]=rotate(p);return{x,y};})}}))}]}]}]}}]};
}
for(const type of ['MIXTO_OPERATION','PANEXUS_OPERATION'])test(`${type}: serial, pedido, fecha y volumen real; bombeo nunca se convierte en horario del camion`,()=>{
 for(const rotation of [0,90,180,270]){
 const d=parseControlGuide(fixture(type==='PANEXUS_OPERATION',rotation),type);
 assert.equal(d.guideNumber,type==='PANEXUS_OPERATION'?'12082':'349463');assert.equal(d.details.orderNumber,'88');assert.equal(d.details.guideDate,'2026-11-03');
 assert.equal(d.arrivalTime,'');assert.equal(d.departureTime,'');assert.equal(d.details.loadingTime,'');
 assert.equal(d.lines.length,1);assert.equal(d.lines[0].quantity,'14');assert.equal(d.lines[0].type,'SERVICE');assert.equal(d.lines[0].productCode,'');assert.equal(d.lines[0].catalogItemId,'');
 assert.match(d.details.observations,/No hubo necesidad/);assert.ok(!d.details.observations.includes('FIRMA'));assert.ok(!d.details.observations.includes('CONFORME'));
 assert.match(d.warnings.join(' '),/volumen real manuscrito/);
 }
});
test('campos ausentes o ilegibles no se sustituyen por volumen estimado, equipo, pedido ni fecha actual',()=>{
 const d=parseControlGuide(fixture(true,0,{badMonth:true,missingVolume:true}),'PANEXUS_OPERATION');
 assert.equal(d.details.guideDate,'');assert.equal(d.lines[0].quantity,'');assert.match(d.warnings.join(' '),/fecha/);assert.match(d.warnings.join(' '),/volumen real/);
});
test('se pueden elegir los tres formularios usando la misma respuesta OCR',()=>{
 const v=parseGuideVariants(fixture());assert.deepEqual(Object.keys(v),['DISPATCH_GUIDE','MIXTO_OPERATION','PANEXUS_OPERATION']);
 assert.equal(v.MIXTO_OPERATION.details.documentType,'MIXTO_OPERATION');assert.equal(v.PANEXUS_OPERATION.details.documentType,'PANEXUS_OPERATION');
 assert.equal(v.PANEXUS_OPERATION.details.orderNumber,'');
});
test('volumen precargado no inventa un codigo o precio; el residente ingresa codigo y horarios antes de guardar',()=>{
 const d={...parseControlGuide(fixture(),'MIXTO_OPERATION'),resident:{castingElement:'PILES_AND_COLUMNS',laboratoryApplied:false}};
 assert.equal(matchGuideCatalog(d.lines[0],[],'M3').warning,null);
 assert.match(validateOcrReview(d),/horas/);
 d.arrivalTime='23:00';d.departureTime='03:00';assert.match(validateOcrReview(d),/tipo, código/);
 d.lines[0].productCode='SERV-MANUAL';d.lines[0].unit='';assert.equal(validateOcrReview(d),null);
 d.details.documentType='INVENTED';assert.match(validateOcrReview(d),/documento/);
});
test('elemento del Excel normaliza las tres opciones y no toma palabras de otro campo',()=>{
 for(const[raw,expected]of [['Pilotes','PILES'],['pilote','PILES'],['Columnas','COLUMNS'],['Pilotes y columnas','PILES_AND_COLUMNS'],['Columnas y pilotes','PILES_AND_COLUMNS'],['PILES_AND_COLUMNS','PILES_AND_COLUMNS'],['Losas',null],['',null]])assert.equal(normalizeCastingElement(raw),expected,raw);
 assert.equal(emptyGuideDetails().documentType,'DISPATCH_GUIDE');
});
