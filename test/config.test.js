// -----------------------------------------------------------------------------
// The configuration: the address (never a URL with the key), the key, the
// relays Gladys may drive, the extensions, the counters, the slots.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  isComplete,
  normalizeConfig,
  parseAddress,
  parseApiKey,
  parseCounters,
  parseExtensions,
  parseRelays,
  sessionKey,
  slotConfig,
  slotTyped,
} from '../src/config.js';

test('the address: IP or name, a port, never a path, a key, https, broadcast or multicast', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { host: '192.168.1.60', port: 80 });
  assert.deepEqual(parseAddress('http://ecort2.local:8080/'), { host: 'ecort2.local', port: 8080 });
  assert.deepEqual(parseAddress('[fe80::1]:81'), { host: 'fe80::1', port: 81 });
  assert.deepEqual(parseAddress(''), {});
  assert.equal(parseAddress('192.168.1.60/api/xdevices.json?key=x').error, 'path');
  assert.equal(parseAddress('user:pass@192.168.1.60').error, 'path');
  assert.equal(parseAddress('https://192.168.1.60').error, 'https');
  for (const bad of [
    '255.255.255.255',
    '0.0.0.0',
    '224.0.0.1',
    'a_b',
    '1.2.3.4:0',
    '1.2.3.4:70000',
  ]) {
    assert.equal(parseAddress(bad).error, 'invalid', bad);
  }
});

test('the API key: printable, no space, 128 at most; empty allowed (protection off)', () => {
  assert.equal(parseApiKey('apikey'), 'apikey');
  assert.equal(parseApiKey('  '), '');
  assert.equal(parseApiKey(undefined), '');
  assert.equal(parseApiKey('a b'), null);
  assert.equal(parseApiKey('x'.repeat(129)), null);
  assert.equal(parseApiKey('clé'), null);
  assert.equal(parseApiKey('a\r\nb'), null);
  assert.equal(isComplete(normalizeConfig({ host: '10.0.0.2' })), true);
  assert.equal(isComplete(normalizeConfig({ host: '10.0.0.2', api_key: 'a b' })), false);
  assert.equal(isComplete(normalizeConfig({ api_key: 'k' })), false);
});

test('relays: R1 to R10, a bare number, :light; the rest reported', () => {
  const { relays, errors } = parseRelays('R1, 2:light; r10\nR11, R0, X8R1-1, R3:pump');
  assert.deepEqual(
    [...relays],
    [
      ['r1', 'switch'],
      ['r2', 'light'],
      ['r10', 'switch'],
    ],
  );
  assert.deepEqual(errors, ['R11', 'R0', 'X8R1-1', 'R3:pump']);
});

test('extensions: FP1 to FP8, THL1 and THL2, ranges; the rest reported', () => {
  const { codes, errors } = parseExtensions('FP1-FP4, fp6, THL1-2, FP9, THL3, FP3-FP1, FP1-THL2');
  assert.deepEqual([...codes], ['fp1', 'fp2', 'fp3', 'fp4', 'fp6', 'thl1', 'thl2']);
  assert.deepEqual(errors, ['FP9', 'THL3', 'FP3-FP1', 'FP1-THL2']);
});

test('counters: C1 to C12, a type, a unit of that type; the default unit; no prototype key', () => {
  const { counters, errors } = parseCounters(
    'C1:water:l, c2=gas, C3:electricity:kwh, C4:water:kwh, C13:gas, C5:constructor, C6:__proto__, C1:gas',
  );
  assert.deepEqual(
    [...counters],
    [
      ['c1', { type: 'water', unit: 'l' }],
      ['c2', { type: 'gas', unit: 'm3' }],
      ['c3', { type: 'electricity', unit: 'kwh' }],
    ],
  );
  assert.equal(errors.length, 5);
  assert.deepEqual(
    [...parseCounters('C7:water:m³').counters],
    [['c7', { type: 'water', unit: 'm3' }]],
  );
});

test('defaults, the slots, what restarts a session', () => {
  const config = normalizeConfig({ host: '10.0.0.2', poll_interval: '2' });
  assert.equal(config.pollInterval, 5);
  assert.equal(config.allowHeatingModes, DEFAULTS.allow_heating_modes);
  assert.equal(normalizeConfig({ allow_heating_modes: 'yes' }).allowHeatingModes, false);
  assert.equal(normalizeConfig({ allow_heating_modes: 'true' }).allowHeatingModes, true);
  const raw = { host: 'a', host_2: 'b:81', api_key_2: 'k', relays_2: 'R1', poll_interval: 30 };
  assert.deepEqual(slotConfig(raw, 2), {
    host: 'b:81',
    api_key: 'k',
    relays: 'R1',
    extensions: undefined,
    counters: undefined,
    allow_heating_modes: undefined,
    poll_interval: 30,
    language: undefined,
  });
  assert.equal(slotTyped(raw, 2), true);
  assert.equal(slotTyped(raw, 3), false);
  const second = normalizeConfig(slotConfig(raw, 2));
  assert.equal(second.port, 81);
  assert.notEqual(second.key, normalizeConfig({ host: 'b' }).key, 'the port is in the identity');
  assert.equal(
    sessionKey(normalizeConfig({ host: 'a', relays: 'R1' })),
    sessionKey(normalizeConfig({ host: 'a', relays: 'R2' })),
    'a relay listed is no new session',
  );
});
