import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averagePaceSecondsPerKm } from './metrics.ts';
test('computes elapsed pace for a 10 km run in 50 minutes', () => assert.equal(averagePaceSecondsPerKm(10000,3000),300));
test('returns null for zero distance or duration', () => { assert.equal(averagePaceSecondsPerKm(0,50),null); assert.equal(averagePaceSecondsPerKm(100,0),null); });
test('rejects invalid inputs', () => { for (const value of [-1,NaN,Infinity]) { assert.throws(()=>averagePaceSecondsPerKm(value,100),RangeError); assert.throws(()=>averagePaceSecondsPerKm(100,value),RangeError); }});
