import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as availability from '../src/features/programming/availability.ts';

const confirmed={status:'CONFIRMED',scheduledAt:'2026-10-01T13:00:00Z',operationStarted:false,hasPermission:true};
test('cancelar usa los permisos y estados existentes, incluido Confirmado vencido',()=>{
 assert.equal(availability.canCancelProgramming(confirmed),true);
 assert.equal(availability.canCancelProgramming({...confirmed,status:'PENDING_CONFIRMATION',version:2}),true);
 for(const patch of [{hasPermission:false},{operationStarted:true},{status:'IN_EXECUTION'},{status:'COMPLETED'},{status:'CANCELLED'}])assert.equal(availability.canCancelProgramming({...confirmed,...patch}),false);
});

test('la consulta inicial de noviembre incluye la semana visible de octubre en Guatemala',async()=>{
 const source=await readFile(new URL('../src/features/programming/queries.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T13:00:00Z']));}}
 const exports={};const imports={'server-only':{},'@/lib/supabase/admin':{},'@/lib/supabase/server':{},'./availability':availability};
 runInNewContext(js,{exports,Intl,Date:FixedDate,require(name){assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});
 const range=exports.getInitialProgrammingRange('America/Guatemala');
 assert.equal(range.start,'2026-10-26T06:00:00.000Z');assert.equal(range.end,'2026-12-08T06:00:00.000Z');
 assert.ok('2026-10-30T13:00:00Z'>range.start&&'2026-10-30T13:00:00Z'<range.end);
});


test('permite cancelar el inicio sin guías y exige comprobar que no existan guías',()=>{
 for(const status of ['CONFIRMED','IN_EXECUTION']){
  assert.equal(availability.canCancelProgramming({...confirmed,status,operationStarted:true,hasGuides:false}),true);
  assert.equal(availability.canCancelProgramming({...confirmed,status,operationStarted:true,hasGuides:true}),false);
  assert.equal(availability.canCancelProgramming({...confirmed,status,operationStarted:true}),false);
  assert.equal(availability.canCancelProgramming({...confirmed,status,hasGuides:false,hasPermission:false}),false);
 }
});
