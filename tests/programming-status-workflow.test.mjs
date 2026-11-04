import assert from 'node:assert/strict';
import test from 'node:test';
import { PROGRAMMING_VISIBLE_STATUSES } from '../src/features/programming/types.ts';
import { DISPATCH_STATUSES } from '../src/features/dispatches/types.ts';
import { canCreateDispatchForProgramming, canConfirmProgramming, getEffectiveProgrammingStatus, isHistoricalProgramming } from '../src/features/programming/availability.ts';

const scheduledAt='2026-11-03T18:00:00-06:00';
const operation={scheduledAt,operationStarted:true,hasPermission:true};

test('el flujo visible separa despacho completo de completado y retira la confirmación manual',()=>{
 assert.deepEqual(PROGRAMMING_VISIBLE_STATUSES,['CONFIRMED','IN_EXECUTION','DISPATCH_COMPLETED','COMPLETED','CANCELLED','EXPIRED']);
 for(const status of PROGRAMMING_VISIBLE_STATUSES)assert.equal(canConfirmProgramming({...operation,status}),false);
});

test('Despacho completo permanece activo y no permite iniciar otro despacho ni se convierte en vencido',()=>{
 const programming={...operation,status:'DISPATCH_COMPLETED'};
 assert.equal(getEffectiveProgrammingStatus(programming,new Date('2026-12-01').valueOf()),'DISPATCH_COMPLETED');
 assert.equal(canCreateDispatchForProgramming(programming),false);
 assert.equal(isHistoricalProgramming({effectiveStatus:'DISPATCH_COMPLETED'}),false);
 assert.equal(isHistoricalProgramming({effectiveStatus:'COMPLETED'}),true);
});

test('los estados del despacho conservan su contrato y vencido sigue siendo una alerta utilizable',()=>{
 assert.deepEqual(DISPATCH_STATUSES,['IN_EXECUTION','COMPLETED']);
 const programming={...operation,status:'CONFIRMED',operationStarted:false};
 assert.equal(getEffectiveProgrammingStatus(programming,new Date('2026-12-01').valueOf()),'EXPIRED');
 assert.equal(canCreateDispatchForProgramming(programming,new Date('2026-12-01').valueOf()),true);
 assert.equal(canCreateDispatchForProgramming({...programming,hasPermission:false}),false);
});
