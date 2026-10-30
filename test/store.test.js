// -----------------------------------------------------------------------------
// /data: a real file (temporary folder, removed after), read back bounded and
// checked; an unreadable file is not an empty one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, normalizeMemory, stateFile } from '../src/store.js';

const KEY = 'a'.repeat(32);
const NOW = Date.UTC(2026, 9, 30);

test('a real file: missing is null, written 0600 through a rename, read back; garbage throws', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rt2-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  const store = fileStore(path);
  assert.equal(await store.load(), null);
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(await store.load(), { a: 2 });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, '{not json');
  await assert.rejects(store.load());
  await writeFile(path, 'x'.repeat(300 * 1024));
  await assert.rejects(store.load(), /too large/);
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json.tmp'), 'utf8').catch(() => '1')), 1);
  assert.equal(stateFile(1), '/data/ecodevices-rt2-state.json');
  assert.equal(stateFile(2), '/data/ecodevices-rt2-state-2.json');
});

test('read back: dates from the future brought to now, pauses capped, bad entries dropped', () => {
  const memory = normalizeMemory(
    {
      lastAttemptAt: NOW + 3_600_000,
      salt: 'b'.repeat(32),
      owner: { kind: 'address', id: KEY },
      key: KEY,
      pause: { until: NOW + 30 * 86_400_000, failures: 99, code: 'weird' },
      refused: { salt: 'c'.repeat(32), tag: 300 },
      guards: [
        { code: 'r1', kind: 'relay', value: 0, resends: 2 },
        { code: 'r2', kind: 'relay', value: 1 },
        { code: 'fp1', kind: 'pilot-wire', value: 5 },
        { code: 'fp2', kind: 'pilot-wire', value: 1, confirmed: true },
        { code: 'r1', kind: 'relay', value: 0 },
        { code: '../x', kind: 'relay', value: 0 },
      ],
      meters: {
        ti1: { feature: 'energy-index', device: 'd1', last: { value: 10, at: NOW }, held: null },
        tore2: { feature: 'energy-index', last: { value: 0, at: NOW } },
        c1: {
          feature: 'water-index',
          last: { value: 5, at: NOW },
          held: { direction: 'up', from: 5, to: 900, threshold: 900, at: NOW },
        },
        c2: { feature: 'switch', last: { value: 5, at: NOW } },
        r1: { feature: 'energy-index', last: { value: 5, at: NOW } },
      },
    },
    NOW,
  );
  assert.equal(memory.lastAttemptAt, NOW);
  assert.equal(memory.pause.until, NOW + 3_600_000);
  assert.equal(memory.pause.failures, 10);
  assert.equal(memory.pause.code, 'failed');
  assert.equal(memory.refused, null);
  assert.deepEqual(
    memory.guards.map((g) => `${g.code}:${g.value}`),
    ['r1:0', 'fp2:1'],
  );
  assert.deepEqual(Object.keys(memory.meters), ['ti1', 'tore2', 'c1']);
  assert.equal(memory.meters.tore2.last, null, 'a reference of 0 is none');
  assert.equal(memory.meters.c1.held.to, 900);
  assert.equal(memory.owner.id, KEY);
});

test('read back: an owner of another kind, a prototype key, a file without a key', () => {
  const memory = normalizeMemory(
    JSON.parse(
      `{"owner":{"kind":"mac","id":"${KEY}"},"meters":{"__proto__":{"feature":"energy-index"}},"guards":[{"code":"r1","kind":"relay","value":0}]}`,
    ),
    NOW,
  );
  assert.equal(memory.owner, null);
  assert.deepEqual(Object.keys(memory.meters), []);
  assert.deepEqual(memory.guards, [], 'no key: no guard');
  assert.equal(Object.getPrototypeOf(memory.meters), Object.prototype);
});
