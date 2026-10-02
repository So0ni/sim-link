import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCalls } from '../src/features/calls/model.ts';
import { dialNumber } from '../src/features/calls/api.ts';
test('stale polls preserve viewed state and delayed calls sort by original time',()=>{
 const old={sequence:1,startedAt:200,viewedAt:300,outcome:'missed'};
 const result=mergeCalls([old],[{...old,viewedAt:null},{sequence:2,startedAt:100,viewedAt:null}]);
 assert.equal(result.length,2);assert.equal(result[0].sequence,1);assert.equal(result[0].viewedAt,300);assert.equal(result[0].outcome,'missed');
});
test('dial links allow phone numbers and reject control sequences and non-phone content',()=>{
 assert.equal(dialNumber('+1 (202) 555-0147'),'+12025550147');
 for(const value of [null,'','Anonymous','*123#','tel:123','123;456','javascript:alert(1)'])assert.equal(dialNumber(value),null);
});

test('stale polls cannot erase a repaired SIM mapping',()=>{
 const known={sequence:1,startedAt:100,viewedAt:null,simKey:'sms-sim-key'};
 assert.equal(mergeCalls([known],[{...known,simKey:null}])[0].simKey,'sms-sim-key');
 assert.equal(mergeCalls([{...known,simKey:null}],[known])[0].simKey,'sms-sim-key');
});
