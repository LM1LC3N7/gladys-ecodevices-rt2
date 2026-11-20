// -----------------------------------------------------------------------------
// The power counters of the RT2 ("compteurs de puissance", `Index_TORE1`..`20`
// of `Index=all` on firmware 3): each one counts a current clamp in the mode
// (consumption, production, injection, drawn) and the unit (kWh, or kVAh) the
// user set in the RT2, neither given by the API. So they are published only
// when listed with their mode in "Power counters" (`T1, T3:production`), in
// kWh (Wh read: GCE wiki, page Tore, "index en Wh"), through the index guard
// (never 0, never lower). A counter counting but not listed is said in the
// status. Values: cce66's `Index=all` of 2026-10-31 (t/11448 #7) and his
// status.json of 2026-11-14 (#19, after a factory reset: every power counter
// at "--", so `Index_TORE` at 0 is nothing to offer).
// Also: cce66's "C1:Eau, C2" (#23) in the pulse counters: French words are
// understood, a counter without a type is said with the form expected.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLAMP_MODES, LIMITS_RT2 } from '../src/constants.js';
import { normalizeConfig, parseClamps, parseCounters } from '../src/config.js';
import { indexKey, meterOf } from '../src/rt2/model.js';
import { definitionOf } from '../src/devices.js';
import { normalizeMemory } from '../src/store.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, START, created, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const meter = (code, feature = 'energy-index', id = `id-${code}`) =>
  created('meter', code, { feature, id });
const TORE = (n, feature = 'energy-index') => F('meter', `tore${n}`, feature);

/** cce66's `Index=all` of 2026-10-31 (his key removed by him), as a fixture. */
const INDEX_ALL = {
  product: 'EcoDevices_RT',
  status: 'Success',
  Index_C1: 149399,
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`Index_C${i + 2}`, 0])),
  Index_TORE1: 271232,
  Index_TORE2: 660664,
  Index_TORE3: 1654075,
  ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`Index_TORE${i + 4}`, 0])),
  Index_TORE17: 1846258,
  Index_TORE18: 8331781,
  Index_TORE19: 0,
  Index_TORE20: 227258,
  Index_TI1: 132533718,
  Index_TI2: 0,
  ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`Index_TI${i + 3}`, 4294967295])),
};

function hisRt2(indexes = INDEX_ALL) {
  const world = fakeRt2();
  world.fixtures.set('all', indexes);
  return world;
}

test('the configuration: T1 to T20, a mode (consumption by default), French words; a code given twice with two modes is refused in whole', () => {
  const { clamps, errors } = parseClamps(
    'T1, t2:production, TORE3=injection, T4:soutirage, T17:conso, T21, T5:kvah, T1:production, C1, T2:prod',
  );
  assert.deepEqual(
    [...clamps],
    [
      ['tore2', { mode: 'production' }],
      ['tore3', { mode: 'injection' }],
      ['tore4', { mode: 'drawn' }],
      ['tore17', { mode: 'consumption' }],
    ],
    'T1 and T1:production: neither kept (the order typed is no choice); T2 twice the same: once',
  );
  assert.deepEqual(errors, ['T21', 'T5:kvah', 'C1', 'TORE1 ×2']);
  assert.deepEqual([...parseClamps('T3:injection, T3').clamps], [], 'whatever the order');
  assert.deepEqual(parseClamps('T3, T1, T3:injection').errors, ['TORE3 ×2']);
  assert.equal(LIMITS_RT2.tore, 20, 'firmware 3: 20 power counters');
  assert.deepEqual([...parseClamps('T20:Injecté').clamps], [['tore20', { mode: 'injection' }]]);
  assert.deepEqual([...parseClamps('').clamps], []);
  assert.deepEqual(parseClamps(undefined).errors, []);
  for (const mode of Object.keys(CLAMP_MODES)) {
    const feature = CLAMP_MODES[mode].feature;
    assert.equal(definitionOf(feature).unit, 'kilowatt-hour', mode);
    assert.equal(definitionOf(feature).min, 0, mode);
  }
  assert.equal(definitionOf('production-index').category, 'energy-production-sensor');
  assert.equal(definitionOf('injection-index').type, 'output-index');
  assert.equal(definitionOf('drawn-index').type, 'input-index');
  const config = normalizeConfig({ ...CONFIG, clamps: 'T1, T2:production' });
  assert.equal(config.clamps.size, 2);
  assert.deepEqual(config.clampErrors, []);
});

test('cce66, #23: "C1:Eau, C2" is a water counter in litres and one counter not understood', () => {
  const { counters, errors } = parseCounters('C1:Eau, C2');
  assert.deepEqual([...counters], [['c1', { type: 'water', unit: 'l' }]]);
  assert.deepEqual(errors, ['C2']);
  assert.deepEqual(
    [...parseCounters('C2:Gaz:m³, C3:Électricité, C4:ELEC:kwh, C5:energie').counters],
    [
      ['c2', { type: 'gas', unit: 'm3' }],
      ['c3', { type: 'electricity', unit: 'wh' }],
      ['c4', { type: 'electricity', unit: 'kwh' }],
      ['c5', { type: 'electricity', unit: 'wh' }],
    ],
  );
  assert.deepEqual(parseCounters('C1:huile, C2:eau:kwh').errors, ['C1:huile', 'C2:eau:kwh']);
});

test('his Index=all: the listed power counters offered and published in kWh; the others said, not offered', async () => {
  const config = { ...CONFIG, clamps: 'T1, T3:production, T18, T19' };
  const { app, gladys, start, wait } = await setup({ world: hisRt2(), config });
  await start();
  await wait(15 * SECOND);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes('ext:rt2:meter:tore1'), ids.join(' '));
  assert.ok(ids.includes('ext:rt2:meter:tore3'));
  assert.ok(ids.includes('ext:rt2:meter:tore18'), 'counter 18 is a counter of the RT2');
  assert.ok(
    ids.includes('ext:rt2:meter:tore19'),
    'listed: offered even at 0 (a value comes later)',
  );
  assert.ok(!ids.includes('ext:rt2:meter:tore2'), 'not listed: not offered');
  assert.ok(!ids.includes('ext:rt2:meter:tore17'));
  const tore3 = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:meter:tore3');
  assert.deepEqual(
    tore3.features.map((f) => f.external_id),
    [TORE(3, 'production-index')],
  );
  assert.equal(tore3.features[0].category, 'energy-production-sensor');
  assert.equal(tore3.features[0].unit, 'kilowatt-hour');
  assert.match(tore3.name, /Compteur de puissance 3 \(TORE3\)/);
  assert.match(
    message(gladys),
    /Power counter\(s\) counting but not listed in Configuration → Power counters: TORE2, TORE17, TORE20\./,
  );
  assert.match(message(gladys, 'fr'), /ne sont pas listés [^:]+: TORE2, TORE17, TORE20\./);
  app.stop();
});

test('his Index=all, devices created: 271.232, 1,654.075 and 8,331.781 kWh (Wh read), never 0', async () => {
  const config = { ...CONFIG, clamps: 'T1, T3:production, T18:injection, T19:drawn' };
  const devices = [
    meter('tore1'),
    meter('tore3', 'production-index'),
    meter('tore18', 'injection-index'),
    meter('tore19', 'drawn-index'),
  ];
  const { app, gladys, start, wait, states, store } = await setup({
    world: hisRt2(),
    config,
    devices,
  });
  await start();
  assert.equal(gladys.fake.lastState(TORE(1)), 271.232);
  assert.equal(gladys.fake.lastState(TORE(3, 'production-index')), 1654.075);
  assert.equal(gladys.fake.lastState(TORE(18, 'injection-index')), 8331.781);
  assert.deepEqual(states(TORE(19, 'drawn-index')), [], '0 is never published');
  assert.equal(store.data.meters.tore1.feature, 'energy-index');
  assert.equal(store.data.meters.tore1.unit, 'wh');
  assert.equal(store.data.meters.tore3.feature, 'production-index');
  await wait(15 * SECOND);
  assert.deepEqual(states(TORE(1)), [271.232], 'an unchanged index is sent once');
  assert.doesNotMatch(message(gladys), /held back/);
  app.stop();
});

test('after his factory reset (status.json 2026-11-14, every power counter at "--"): the listed ones offered without value and named, no index counted', async () => {
  const status = JSON.parse(
    readFileSync(new URL('./fixtures/cce66-status-3.00.04.json', import.meta.url)),
  );
  for (let n = 0; n < 20; n += 1) {
    assert.equal(status[`ioname5${n}`], `Compteur puissance ${n + 1}`, 'the 20 power counters');
    assert.match(status[`indexcourant5${n}`], /^--/, 'no index yet');
  }
  // What `Index=all` gives for a counter at "--" is not known (0 or 4294967295): neither is an index.
  const zeros = { ...INDEX_ALL };
  for (let n = 1; n <= 20; n += 1) zeros[`Index_TORE${n}`] = n % 2 ? 0 : 4294967295;
  const config = { ...CONFIG, clamps: 'T1, T2' };
  const { app, gladys, start, wait, states } = await setup({ world: hisRt2(zeros), config });
  await start();
  await wait(15 * SECOND);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes('ext:rt2:meter:tore1'), 'listed: offered, waits for a value');
  assert.deepEqual(states(TORE(1)), []);
  assert.deepEqual(states(TORE(2)), []);
  assert.doesNotMatch(message(gladys), /counting but not listed/);
  assert.match(
    message(gladys),
    /: 10 relay\(s\), 12 input\(s\), 1 index\(es\)\./,
    'TI1 only: no value, no index counted',
  );
  assert.match(
    message(gladys),
    /Index\(es\) listed but without a value \([^)]*Compteurs de puissance[^)]*\): TORE1, TORE2\./,
  );
  assert.match(
    message(gladys, 'fr'),
    /Index listé\(s\) mais sans valeur [^:]+: TORE1, TORE2\. Rien n’est publié/,
  );
  // The "--" strings of his status.json, if `Index=all` ever answered them: the same.
  const dashes = { ...INDEX_ALL };
  for (let n = 1; n <= 20; n += 1) dashes[`Index_TORE${n}`] = '--      ';
  const second = await setup({
    world: hisRt2(dashes),
    config: { ...CONFIG, clamps: 'T1', counters: 'C2:eau' },
  });
  await second.start();
  await second.wait(15 * SECOND);
  assert.deepEqual(second.states(TORE(1)), []);
  assert.match(
    message(second.gladys),
    /without a value [^:]+: TORE1, C2\./,
    'a pulse counter at 0 too',
  );
  second.app.stop();
  app.stop();
});

test('firmware 2 (Index_TORE_Cons1 present): no power counter read, not even TORE5-16, said in the status', async () => {
  const old = { ...INDEX_ALL };
  for (let n = 1; n <= 20; n += 1) delete old[`Index_TORE${n}`];
  old.Index_TORE_Cons1 = 271232;
  old.Index_TORE_Dist1 = 660664;
  for (let n = 5; n <= 16; n += 1) old[`Index_TORE${n}`] = n === 5 ? 512345 : 0;
  const { app, gladys, start, wait, states } = await setup({
    world: hisRt2(old),
    config: { ...CONFIG, clamps: 'T1, T5' },
    devices: [meter('tore1'), meter('tore5')],
  });
  await start();
  await wait(15 * SECOND);
  assert.deepEqual(states(TORE(1)), []);
  assert.deepEqual(
    states(TORE(5)),
    [],
    'Index_TORE5 of firmware 2 is a clamp, not a power counter',
  );
  assert.match(message(gladys), /firmware 2 \(Index_TORE_Cons1\): the power counters are not read/);
  assert.match(message(gladys, 'fr'), /pinces du firmware 2/);
  assert.match(message(gladys), /, 1 index\(es\)\./, 'TI1 only');
  assert.doesNotMatch(message(gladys), /counting but not listed/);
  assert.equal(indexKey('tore1'), 'Index_TORE1');
  assert.equal(
    meterOf('tore1', old.Index_TORE1, undefined, new Map([['tore1', { mode: 'consumption' }]]))
      .value,
    undefined,
  );
  app.stop();
});

for (const [mode, feature] of [
  ['', 'energy-index'],
  [':production', 'production-index'],
  [':injection', 'injection-index'],
  [':drawn', 'drawn-index'],
]) {
  test(`T3${mode}: a held jump stays held across a restart 50 h later (its state read back from /data)`, async () => {
    const world = hisRt2();
    const config = { ...CONFIG, clamps: `T3${mode}` };
    const device = () => meter('tore3', feature);
    const first = await setup({ world, config, devices: [device()] });
    await first.start();
    const id = TORE(3, feature);
    assert.deepEqual(first.states(id), [1654.075]);
    world.fixtures.set('all', { ...INDEX_ALL, Index_TORE3: 6654075 });
    await first.wait(15 * SECOND);
    assert.equal(first.store.data.meters.tore3.held?.direction, 'up', 'held before the restart');
    assert.equal(first.store.data.meters.tore3.feature, feature);
    const kept = normalizeMemory(first.store.data, first.clock.now()).meters.tore3;
    assert.equal(kept?.held?.direction, 'up', `${feature}: the state is read back`);
    first.app.stop();
    await first.clock.advance(50 * 3600 * SECOND);
    const d = device();
    const f = d.features.find((x) => x.external_id === id);
    f.last_value = 1654.075;
    f.last_value_changed = new Date(START + 1000).toISOString();
    const second = await setup({
      world,
      config,
      devices: [d],
      store: first.store,
      clock: first.clock,
    });
    await second.start();
    await second.wait(15 * SECOND);
    assert.ok(!second.states(id).includes(6654.075), `${feature}: the jump needs the two clicks`);
    assert.match(message(second.gladys), /Index held back, not sent to Gladys: TORE3/);
    second.app.stop();
  });
}

test('a drop of a power counter (erased in the RT2) is held; a mode changed is a new feature', async () => {
  const world = hisRt2();
  const config = { ...CONFIG, clamps: 'T1' };
  const { app, gladys, start, wait, states, store } = await setup({
    world,
    config,
    devices: [meter('tore1')],
  });
  await start();
  world.fixtures.set('all', { ...INDEX_ALL, Index_TORE1: 12 });
  await wait(15 * SECOND);
  assert.ok(
    states(TORE(1)).every((v) => v === 271.232),
    'never lower',
  );
  assert.match(
    message(gladys),
    /Index held back, not sent to Gladys: TORE1 271\.232 → 0\.012 kWh \(drop\)/,
  );
  assert.equal(store.data.meters.tore1.held.direction, 'down');
  await app.configUpdated({ ...CONFIG, clamps: 'T1:production' });
  await wait(15 * SECOND);
  const tore1 = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:meter:tore1');
  assert.deepEqual(
    tore1.features.map((f) => f.external_id),
    [TORE(1, 'production-index'), TORE(1)],
    'the new feature, the old one kept',
  );
  assert.equal(gladys.fake.lastState(TORE(1, 'production-index')), undefined, 'not created yet');
  app.stop();
});

test('a power counter no longer listed: its device keeps its last value, nothing more sent', async () => {
  const world = hisRt2();
  const { app, gladys, start, wait, states } = await setup({
    world,
    config: { ...CONFIG, clamps: 'T1' },
    devices: [meter('tore1')],
  });
  await start();
  assert.equal(gladys.fake.lastState(TORE(1)), 271.232);
  await app.configUpdated({ ...CONFIG, clamps: '' });
  world.fixtures.set('all', { ...INDEX_ALL, Index_TORE1: 300000 });
  await wait(15 * SECOND);
  assert.deepEqual(states(TORE(1)), [271.232]);
  assert.match(message(gladys), /not listed [^:]+: TORE1, TORE2/);
  app.stop();
});
