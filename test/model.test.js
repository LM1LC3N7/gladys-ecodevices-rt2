// -----------------------------------------------------------------------------
// What the answers mean: the envelope (product, status), strict values (a
// text, '' or null never 0), the indexes and their units, the writes (never
// zone 00, never out of range).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, PILOT } from '../src/constants.js';
import {
  checkEnvelope,
  indexKey,
  indexNumber,
  kindOf,
  meterOf,
  valueOf,
  writeQuery,
  zoneKey,
} from '../src/rt2/model.js';

test('the envelope: an Eco-Devices RT2, another product, an error, not an object', () => {
  assert.deepEqual(checkEnvelope({ product: 'EcoDevices_RT', status: 'Success' }), { ok: true });
  assert.deepEqual(
    checkEnvelope({ status: 'Success' }),
    { error: 'bad_response' },
    'no product: not taken for an RT2 (pyecodevices_rt2 refuses it too)',
  );
  assert.deepEqual(checkEnvelope({ product: 'EcoDevices_RT' }), { ok: true });
  assert.deepEqual(checkEnvelope({ product: 'IPX800_V4', status: 'Success' }), {
    error: 'wrong_product',
    product: 'IPX800_V4',
  });
  assert.equal(checkEnvelope({ product: 'x\u0000\ny', status: 'Success' }).product, 'x  y');
  assert.equal(checkEnvelope({ product: 'EcoDevices_RT', status: 'Error' }).error, 'not_success');
  assert.equal(checkEnvelope({ R1: 1 }).error, 'bad_response');
  for (const bad of [null, [], 'text', 3]) assert.equal(checkEnvelope(bad).error, 'bad_response');
});

test('values: 0/1 only, mode texts, X-THL in range; never a text as 0; no prototype key', () => {
  assert.equal(valueOf({ R3: 1 }, KINDS.RELAY, 3), 1);
  assert.equal(valueOf({ R3: '1' }, KINDS.RELAY, 3), undefined);
  assert.equal(valueOf({ D1: 2 }, KINDS.INPUT, 1), undefined);
  assert.equal(valueOf({ 'FP2 Zone 1': 'Hors Gel' }, KINDS.PILOT, 5), PILOT.FROST_PROTECTION);
  assert.equal(valueOf({ 'FP1 Zone 1': 'Arrêt' }, KINDS.PILOT, 1), PILOT.OFF);
  assert.equal(valueOf({ 'FP1 Zone 1': 0 }, KINDS.PILOT, 1), undefined);
  assert.equal(valueOf({ 'FP1 Zone 1': 'toString' }, KINDS.PILOT, 1), undefined);
  assert.deepEqual(valueOf({ 'THL1-TEMP': 20.5, 'THL1-HUM': 120, 'THL1-LUM': '' }, KINDS.THL, 1), {
    temperature: 20.5,
    humidity: undefined,
    luminosity: undefined,
  });
  assert.equal(valueOf({}, KINDS.THL, 1), undefined);
  const polluted = JSON.parse('{"__proto__": {"R1": 1}}');
  assert.equal(valueOf(polluted, KINDS.RELAY, 1), undefined);
  assert.equal(zoneKey(8), 'FP2 Zone 4');
});

test('codes and kinds: within the sizes of the RT2', () => {
  assert.equal(kindOf('r10'), KINDS.RELAY);
  assert.equal(kindOf('r11'), undefined);
  assert.equal(kindOf('d12'), KINDS.INPUT);
  assert.equal(kindOf('fp8'), KINDS.PILOT);
  assert.equal(kindOf('fp9'), undefined);
  assert.equal(kindOf('fp0'), undefined);
  assert.equal(kindOf('thl3'), undefined);
  assert.equal(kindOf('tore16'), KINDS.METER);
  assert.equal(kindOf('ti8'), undefined);
  assert.equal(kindOf('c12'), KINDS.METER);
  assert.equal(indexKey('tore3'), 'Index_TORE3');
  assert.equal(indexKey('ti1'), 'Index_TI1');
  assert.equal(indexKey('c12'), 'Index_C12');
});

test('indexes: numbers or plain decimal texts, never 0 published; units', () => {
  assert.equal(indexNumber(12), 12);
  assert.equal(indexNumber('0012.5'), 12.5);
  for (const bad of ['', ' ', null, '1e9', '-5', 'abc', '0x10', NaN, Infinity, -1, true, '12,5']) {
    assert.equal(indexNumber(bad), undefined, String(bad));
  }
  assert.deepEqual(meterOf('ti1', 12_345_678), {
    feature: 'energy-index',
    value: 12345.678,
    raw: 12_345_678,
  });
  assert.equal(meterOf('tore2', 0).value, undefined, '0 is no index');
  assert.equal(meterOf('c1', 5), undefined, 'a counter not configured');
  const counters = new Map([
    ['c1', { type: 'water', unit: 'l' }],
    ['c2', { type: 'gas', unit: 'm3' }],
    ['c3', { type: 'electricity', unit: 'kwh' }],
  ]);
  assert.deepEqual(meterOf('c1', 123_456, counters), {
    feature: 'water-index',
    value: 123.456,
    raw: 123_456,
  });
  assert.equal(meterOf('c2', 42, counters).value, 42);
  assert.equal(meterOf('c3', 7, counters).feature, 'energy-index');
});

test('writes: SetR/ClearR 01-10, SetFP 01-08 with the code; never zone 00 nor out of range', () => {
  assert.equal(writeQuery({ kind: KINDS.RELAY, n: 3 }, 1), 'SetR=03');
  assert.equal(writeQuery({ kind: KINDS.RELAY, n: 10 }, 0), 'ClearR=10');
  assert.equal(writeQuery({ kind: KINDS.RELAY, n: 11 }, 0), undefined);
  assert.equal(writeQuery({ kind: KINDS.RELAY, n: 1 }, 2), undefined);
  assert.equal(writeQuery({ kind: KINDS.PILOT, n: 5 }, PILOT.OFF, 3), 'SetFP05=3');
  assert.equal(writeQuery({ kind: KINDS.PILOT, n: 0 }, PILOT.OFF, 3), undefined);
  assert.equal(writeQuery({ kind: KINDS.PILOT, n: 9 }, PILOT.OFF, 3), undefined);
  assert.equal(writeQuery({ kind: KINDS.PILOT, n: 1 }, 9, undefined), undefined);
  assert.equal(writeQuery({ kind: KINDS.INPUT, n: 1 }, 1), undefined);
});
