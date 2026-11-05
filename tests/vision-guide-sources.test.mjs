import assert from 'node:assert/strict';
import test from 'node:test';
import {validateGuideSource,guideSourceLabel,openGuidePdf,GUIDE_PHOTO_MAX_BYTES,GUIDE_PDF_MAX_BYTES} from '../src/features/vision-ocr/guide-sources.ts';

test('carga de fotos y PDF mantiene límites y no acepta archivos vacíos o de otro tipo',()=>{
 assert.equal(validateGuideSource({name:'guia.jpg',type:'image/jpeg',size:1},false),null);
 assert.equal(validateGuideSource({name:'guia.pdf',type:'application/pdf',size:20*1024*1024},true),null);
 assert.match(validateGuideSource({name:'guia.pdf',type:'application/pdf',size:GUIDE_PDF_MAX_BYTES+1},true),/20 MiB/);
 assert.match(validateGuideSource({name:'guia.jpg',type:'image/jpeg',size:GUIDE_PHOTO_MAX_BYTES+1},false),/10 MiB/);
 assert.match(validateGuideSource({name:'guia.pdf',type:'application/pdf',size:1},false),/JPG/);
 assert.match(validateGuideSource({name:'guia.pdf',type:'application/pdf',size:0},true),/vacío/);
});
test('cada página conserva procedencia sin confundir el nombre del archivo con el número de guía',()=>{
 const file=new File(['%PDF-1.3'],'evidencias.pdf',{type:'application/pdf'});
 assert.equal(guideSourceLabel({id:'page-2',file,pageNumber:2,totalPages:4}),'evidencias.pdf · página 2 de 4');
 assert.equal(guideSourceLabel({id:'photo',file}),file.name);
});
test('un PDF con extensión correcta y contenido inválido se rechaza antes de cargar el lector',async()=>{
 await assert.rejects(openGuidePdf(new File(['esto no es un pdf'],'guia.pdf',{type:'application/pdf'})),/contenido no corresponde/);
});
