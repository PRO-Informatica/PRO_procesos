import assert from 'node:assert/strict';
import test from 'node:test';
import {detectGuideBoundary, detectGuideOrientation, chooseGuideContrast} from '../src/features/vision-ocr/automatic-image.ts';
import {FULL_GUIDE_CROP} from '../src/features/vision-ocr/image-preparation.ts';
import {guideReadingTurns} from '../src/features/vision-ocr/complete-guide-parser.ts';

function photo(polygons, {background=40,paper=235,ink=true}={}) {
 const width=300,height=400,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const inside=polygons.some(points=>points.every((p,i)=>{const q=points[(i+1)%points.length];return(q.x-p.x)*(y-p.y)-(q.y-p.y)*(x-p.x)>=0}));
  const value=inside?(ink&&x>80&&x<220&&y>100&&y<300&&(y%25<2||x%38<2)?85:paper):background;
  const i=(y*width+x)*4;data[i]=value;data[i+1]=value;data[i+2]=value;data[i+3]=255;
 }
 return{data,width,height};
}
const sheet=[{x:36,y:40},{x:270,y:64},{x:248,y:365},{x:20,y:344}];
test('detecta las cuatro esquinas con perspectiva, dejando margen para el texto de los bordes',()=>{
 const p=photo([sheet]),result=detectGuideBoundary(p.data,p.width,p.height);
 assert.equal(result.detected,true);
 result.crop.forEach((point,i)=>{assert.ok(Math.abs(point.x-sheet[i].x/(p.width-1))<.025);assert.ok(Math.abs(point.y-sheet[i].y/(p.height-1))<.025)});
});
test('fondo blanco, contraste ambiguo o dos hojas conservan la imagen completa',()=>{
 const second=[{x:160,y:30},{x:285,y:30},{x:285,y:370},{x:160,y:370}];
 const first=[{x:15,y:30},{x:140,y:30},{x:140,y:370},{x:15,y:370}];
 for(const p of [photo([sheet],{background:232}),photo([sheet],{paper:110,background:105}),photo([first,second])]){
  const result=detectGuideBoundary(p.data,p.width,p.height);assert.equal(result.detected,false);assert.deepEqual(result.crop,FULL_GUIDE_CROP);
 }
});
test('no recorta una celda o un marco interior como si fuera la hoja completa',()=>{
 const p=photo([], {background:240});
 for(let y=60;y<350;y++)for(let x=40;x<260;x++)if(x<46||x>254||y<66||y>344){const i=(y*p.width+x)*4;p.data.fill(30,i,i+3)}
 assert.equal(detectGuideBoundary(p.data,p.width,p.height).detected,false);
});
test('no estira una región pequeña, una foto sin papel o un análisis fuera de límites',()=>{
 const p=photo([[{x:110,y:150},{x:200,y:150},{x:200,y:250},{x:110,y:250}]]);
 assert.equal(detectGuideBoundary(p.data,p.width,p.height).detected,false);
 assert.equal(detectGuideBoundary(new Uint8ClampedArray(4),1,1).detected,false);
});
function tones(ink,paper,colors=false){
 const data=new Uint8ClampedArray(10000*4);
 for(let p=0;p<10000;p++){const value=p%10===0?ink:paper;data[p*4]=value;data[p*4+1]=value;data[p*4+2]=colors?Math.max(0,value-60):value;data[p*4+3]=255}
 return data;
}
test('contraste automático conserva tinta de color y fotografías ya legibles',()=>{
 assert.equal(chooseGuideContrast(tones(20,245)).apply,false);
 assert.equal(chooseGuideContrast(tones(180,235,true)).reason,'KEEP_COLOR');
});
test('solo aumenta suavemente contraste bajo; no promete recuperar fotos borrosas o reflejos',()=>{
 const faint=chooseGuideContrast(tones(180,235));assert.equal(faint.apply,true);assert.ok(faint.gain>1&&faint.gain<=1.35);
 for(const data of [tones(250,253),tones(20,90),new Uint8ClampedArray(0)])assert.equal(chooseGuideContrast(data).apply,false);
});
test('orientación automática usa votos del mismo OCR, incluso letras cerca de +180 y -180 grados',()=>{
 const response=angles=>({responses:[{fullTextAnnotation:{pages:[{blocks:[{paragraphs:[{words:angles.map(deg=>{const angle=deg*Math.PI/180;return{symbols:[{text:'G'},{text:'U'},{text:'I'},{text:'A'}],boundingBox:{vertices:[{x:100,y:100},{x:100+50*Math.cos(angle),y:100+50*Math.sin(angle)},{x:100,y:120},{x:90,y:120}]}}})}]}]}]}}]});
 for(const[angles,turns]of [[[0,1,-1],0],[[90,89,91],3],[[179,-179,180],2],[[-90,-89,-91],1]])assert.equal(guideReadingTurns(response(angles)),turns);
 assert.equal(guideReadingTurns(response([90,0,180,-90])),0);
 assert.equal(guideReadingTurns(response([90])),0);
});

test('acomoda el logo de la guía antes de leer: cuatro orientaciones y sin girar por ser foto vertical',()=>{
 const width=400,height=300;
 for(const[cx,cy,turns]of [[50,45,0],[350,45,3],[350,255,2],[50,255,1]]){
  const data=new Uint8ClampedArray(width*height*4).fill(245);
  for(let y=cy-15;y<cy+15;y++)for(let x=cx-20;x<cx+20;x++){const i=(y*width+x)*4;data[i]=225;data[i+1]=45;data[i+2]=40;data[i+3]=255;}
  assert.equal(detectGuideOrientation(data,width,height),turns);
 }
 assert.equal(detectGuideOrientation(new Uint8ClampedArray(300*400*4).fill(240),300,400),0);
 assert.equal(detectGuideOrientation(new Uint8ClampedArray(4),1,1),0);
});
