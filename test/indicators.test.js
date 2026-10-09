import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema } from '../src/indicators/ma.js';
import { crossovers } from '../src/indicators/cross.js';
import { computeHpdr } from '../src/indicators/hpdr.js';

test('SMA', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('EMA seeded with SMA', () => {
  const r = ema([1, 2, 3, 4, 5], 3); // k = 0.5
  assert.deepEqual(r, [null, null, 2, 3, 4]);
  const r2 = ema([2, 4, 6, 10], 3); // seed 4, then 10*0.5+4*0.5 = 7
  assert.deepEqual(r2, [null, null, 4, 7]);
});

test('crossovers ignore the open candle', () => {
  const fast = [1, 1, 3, 3, 1];
  const slow = [2, 2, 2, 2, 2];
  assert.deepEqual(crossovers(fast, slow), [
    { index: 2, type: 'bull' }, { index: 4, type: 'bear' },
  ]);
  assert.deepEqual(crossovers(fast, slow, 3), [{ index: 2, type: 'bull' }]);
});

test('HPDR levels sit between range low and high', () => {
  const high = [10, 12, 14, 13, 15], low = [5, 6, 7, 8, 9], close = [8, 10, 12, 11, 15];
  const r = computeHpdr({ high, low, close }, { longLength: 3, shortLength: 2, longWeight: 0.5, levels: [0, 50, 100] });
  // i=4: long hi=15 lo=7, short hi=15 lo=8 → top 15, bot 7.5
  assert.equal(r.levels[100][4], 15);
  assert.equal(r.levels[0][4], 7.5);
  assert.equal(r.levels[50][4], 11.25);
  assert.equal(r.position[4], 100);
  assert.equal(r.levels[50][1], null);
});
