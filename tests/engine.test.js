import {test} from 'node:test';import assert from 'node:assert/strict';import {calculate,target,fifo} from '../src/engine.js';
const lots=[{qty:100,price:100,fee:0,date:'2025-01-01'}];
test('original 27% example',()=>{const r=calculate(lots,100,150,0,0,27);assert.equal(r.tax,1350);assert.equal(r.cash,13650);assert.equal(target(r,0).price,136.5);assert.equal(target(r,5).price,130);assert.equal(target(r,10).price,124.09)});
test('FIFO partial sale and proportional purchase fees',()=>{const l=[{qty:10,price:150,fee:10,date:'2025-02-01'},{qty:10,price:100,fee:10,date:'2025-01-01'}];const f=fifo(l,15);assert.equal(f.basis,1765);assert.equal(f.remaining[0].qty,5);assert.equal(f.remaining[0].fee,5)});
test('German rate, sale fees and offsets',()=>{const r=calculate(lots,100,150,10,1,26.375,1000,500);assert.equal(r.tax,920.49);assert.equal(r.cash,14069.51)});
test('loss creates no assumed tax refund',()=>assert.equal(calculate(lots,100,90,1,1,27).tax,0));
test('whole share rounding and affordability',()=>{const r=calculate(lots,3,150,1,1,27);const t=target(r,5,true);assert.equal(t.qty,4);assert.ok(t.qty*t.price+1<=r.cash)});
test('invalid and oversell rejected',()=>{assert.throws(()=>fifo(lots,101));assert.throws(()=>fifo(lots,0));assert.throws(()=>calculate(lots,100,NaN,0,0,27));assert.throws(()=>calculate(lots,100,150,-1,0,27))});
