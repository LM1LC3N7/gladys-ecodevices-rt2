// -----------------------------------------------------------------------------
// The teleinformation details (`Get=TI`) and the posts (`Get=P`), from the
// answers of cce66's RT2 (t/11448 post 21, 2026-11-18; Sagem SC10 in historic
// teleinformation), kept in test/fixtures (ADCO and BASE masked):
//   PAPP "00870" -> 870 VA, IINST "004" -> 4 A, PTEC "TH.." -> "All hours";
//   INSTANT_POSTE1..8 = 0 -> 0 W for a post listed (a real value), nothing
//   for a post not listed (a post without clamp reads 0 too).
// BASE is the index Index_TI1 already gives (the same Wh): not read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { targetStates } from '../src/devices.js';
import { kindOf, teleinfoNote, valueOf } from '../src/rt2/model.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const GET_TI = fixture('cce66-get-ti-3.00.04.json');
const GET_P = fixture('cce66-get-p-3.00.04.json');

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const TIC = (key) => F('teleinfo', 'tic1', key);
const POST = (n) => F('post', `p${n}`, 'power');

test('his Get=TI: 870 VA, 4 A, the period TH..; ADCO masked', () => {
  assert.match(GET_TI.ADCO, /^0+$/);
  assert.equal(kindOf('tic1'), 'teleinfo');
  assert.equal(kindOf('tic2'), undefined);
  assert.equal(kindOf('ti1'), 'meter');
  assert.deepEqual(valueOf(GET_TI, 'teleinfo', 1), {
    apparentPower: 870,
    current: 4,
    period: 'TH..',
  });
  const states = (json, lang) =>
    Object.fromEntries(
      targetStates({ kind: 'teleinfo', value: valueOf(json, 'teleinfo', 1) }, new Set(), lang),
    );
  assert.deepEqual(states(GET_TI, 'fr'), {
    'apparent-power': { state: 870 },
    current: { state: 4 },
    'tariff-period': { text: 'Toutes les heures' },
  });
  assert.deepEqual(states(GET_TI, 'en')['tariff-period'], { text: 'All hours' });
  assert.deepEqual(states({ ...GET_TI, PTEC: 'HPJR' }, 'fr')['tariff-period'], {
    text: 'Heures pleines jour rouge (Tempo)',
  });
});

test('Get=TI: three-phase and standard mode are said, not read', () => {
  assert.equal(teleinfoNote(GET_TI), undefined);
  assert.equal(teleinfoNote({ ...GET_TI, IINST: '', IINST1: '004' }), 'three-phase');
  assert.equal(
    teleinfoNote({ product: 'EcoDevices_RT', status: 'Success', SINSTS: '00870' }),
    'not-historic',
  );
  assert.equal(teleinfoNote(undefined), undefined);
});

test('Get=TI: a text not understood is unknown, never 0 nor a period', () => {
  for (const raw of ['', ' ', '--', 'abc', '8.7', '-1', '0x10', null, true, 1.5, '1234567']) {
    const value = valueOf({ ...GET_TI, PAPP: raw, IINST: raw }, 'teleinfo', 1);
    assert.equal(value.apparentPower, undefined, JSON.stringify(raw));
    assert.equal(value.current, undefined, JSON.stringify(raw));
  }
  assert.equal(valueOf({ ...GET_TI, PAPP: '100000' }, 'teleinfo', 1).apparentPower, undefined);
  assert.equal(valueOf({ ...GET_TI, IINST: '1000' }, 'teleinfo', 1).current, undefined);
  assert.equal(valueOf({ ...GET_TI, PAPP: '00000' }, 'teleinfo', 1).apparentPower, 0, 'a real 0');
  assert.equal(valueOf({ ...GET_TI, PAPP: 870 }, 'teleinfo', 1).apparentPower, 870);
  for (const raw of ['', 'XXXX', 'th..', 0, 1, '__proto__', 'constructor']) {
    const value = valueOf({ ...GET_TI, PTEC: raw }, 'teleinfo', 1);
    assert.equal(value.period, undefined, JSON.stringify(raw));
    const out = targetStates({ kind: 'teleinfo', value }, new Set(), 'fr');
    assert.ok(!out.some(([key]) => key === 'tariff-period'));
  }
  assert.equal(valueOf({ product: 'EcoDevices_RT', PTEC: '' }, 'teleinfo', 1), undefined);
});

test('his Get=P: 0 W is a value; a text, a missing post or out of range is not', () => {
  for (let n = 1; n <= 8; n += 1) assert.equal(valueOf(GET_P, 'post', n), 0, `P${n}`);
  assert.equal(kindOf('p8'), 'post');
  assert.equal(kindOf('p9'), undefined);
  assert.deepEqual(targetStates({ kind: 'post', value: 0 }, new Set()), [['power', { state: 0 }]]);
  assert.deepEqual(targetStates({ kind: 'post', value: NaN }, new Set()), []);
  assert.equal(valueOf({ ...GET_P, INSTANT_POSTE1: 1234.5 }, 'post', 1), 1234.5);
  assert.equal(valueOf({ ...GET_P, INSTANT_POSTE1: -800 }, 'post', 1), -800);
  for (const raw of ['0', '', null, 1e9, NaN]) {
    assert.equal(valueOf({ ...GET_P, INSTANT_POSTE1: raw }, 'post', 1), undefined, String(raw));
  }
  assert.equal(valueOf({ product: 'EcoDevices_RT' }, 'post', 1), undefined);
});

/** His RT2 answering his Get=TI and Get=P. */
function hisRt2() {
  const world = fakeRt2();
  world.fixtures.set('TI', GET_TI);
  world.fixtures.set('P', GET_P);
  return world;
}

test('his RT2 with TIC and P1-P2 listed: Discover, the states Gladys shows', async () => {
  const world = hisRt2();
  const devices = [created('teleinfo', 'tic1'), created('post', 'p1'), created('post', 'p2')];
  const { app, gladys, start, wait, states } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'TIC, P1-P2' },
  });
  await start();
  await wait(15 * SECOND);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  for (const id of ['ext:rt2:teleinfo:tic1', 'ext:rt2:post:p1', 'ext:rt2:post:p2']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes('ext:rt2:post:p3'), 'a post not listed is not offered');
  const tic = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:teleinfo:tic1');
  assert.equal(tic.name, 'Téléinformation 1 (TIC1)');
  assert.equal(tic.model, 'Eco-Devices RT2 TIC');
  assert.equal(
    gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:post:p1').model,
    'Eco-Devices RT2 Poste',
  );
  assert.deepEqual(
    tic.features.map((f) => [f.name, f.category, f.type, f.unit ?? null]),
    [
      ['Puissance apparente', 'energy-sensor', 'power', 'volt-ampere'],
      ['Intensité', 'energy-sensor', 'current', 'ampere'],
      ['Période tarifaire', 'text', 'text', null],
    ],
  );
  assert.equal(gladys.fake.lastState(TIC('apparent-power')), 870);
  assert.equal(gladys.fake.lastState(TIC('current')), 4);
  const period = gladys.fake.states.filter(
    (s) => s.device_feature_external_id === TIC('tariff-period'),
  );
  assert.equal(period.at(-1)?.text, 'Toutes les heures');
  assert.equal(gladys.fake.lastState(POST(1)), 0, 'a post listed: 0 W is published');
  assert.equal(gladys.fake.lastState(POST(2)), 0);
  assert.deepEqual(states(POST(3)), []);
  assert.match(message(gladys), /1 teleinformation, 2 post\(s\)/);
  assert.match(message(gladys, 'fr'), /1 téléinformation, 2 poste\(s\)/);
  assert.equal(world.reads().filter((r) => /Get=TI$/.test(r.path)).length >= 2, true);
  app.stop();
});

test('nothing listed: Get=TI and Get=P never read, nothing offered', async () => {
  const world = hisRt2();
  const { app, gladys, start, wait } = await setup({ world });
  await start();
  await wait(15 * SECOND);
  assert.ok(!world.reads().some((r) => /Get=(TI|P)$/.test(r.path)));
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(!ids.some((id) => /teleinfo|post/.test(id)), ids.join(' '));
  app.stop();
});

test('Get=TI or Get=P failing: the round goes on, nothing published for them, said', async () => {
  const world = hisRt2();
  world.failGroups.set('TI', 500);
  world.failGroups.set('P', 500);
  const devices = [created('teleinfo', 'tic1'), created('post', 'p1'), created('relay', 'r1')];
  const { app, gladys, start, wait, states } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'TIC, P1' },
  });
  await start();
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), 0);
  for (const key of ['apparent-power', 'current', 'tariff-period']) {
    assert.deepEqual(states(TIC(key)), [], key);
  }
  assert.deepEqual(states(POST(1)), [], 'never 0 for a post not read');
  assert.match(message(gladys), /Not read this time .*teleinformation, posts/);
  // Read again: published.
  world.failGroups.clear();
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(TIC('apparent-power')), 870);
  assert.equal(gladys.fake.lastState(POST(1)), 0);
  app.stop();
});

test('unlisted later: the teleinformation and the posts are no longer read', async () => {
  const world = hisRt2();
  const config = { ...CONFIG, extensions: 'TIC, P1' };
  const { app, start, wait } = await setup({ world, config });
  await start();
  await app.configUpdated({ ...config, extensions: '' });
  // At once, before the next round: no longer a target (nor counted in the status).
  assert.ok(![...app.model.keys()].some((code) => /^(tic|p)\d/.test(code)));
  const before = world.reads().length;
  await wait(15 * SECOND);
  await wait(15 * SECOND);
  assert.ok(world.reads().length > before);
  assert.ok(
    !world
      .reads()
      .slice(before)
      .some((r) => /Get=(TI|P)$/.test(r.path)),
  );
  assert.ok(![...app.model.keys()].some((code) => /^(tic|p)\d/.test(code)));
  app.stop();
});

// Review rt2-020 r1, I1: seven groups on a slow box; Get=TI silent. The budget of the round
// leaves Get=P unsent: unread and said, the relays and the index still published.
test('a slow box, Get=TI silent: the relays and the index published, TIC and the posts said unread', async () => {
  const world = hisRt2();
  world.latency = (r) => (/Get=TI$/.test(r.path) ? 60 * SECOND : 3 * SECOND);
  const devices = [
    created('relay', 'r1'),
    created('meter', 'ti1', { feature: 'energy-index', id: 'id-ti1' }),
    created('teleinfo', 'tic1'),
    created('post', 'p1'),
  ];
  const { app, gladys, start, wait, states } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1, THL1, TIC, P1' },
  });
  await start();
  await wait(25 * SECOND);
  const order = world
    .reads()
    .slice(0, 7)
    .map((r) => /(Get=\w+|Index=all)$/.exec(r.path)[1]);
  assert.deepEqual(order.slice(0, 3), ['Get=R', 'Get=D', 'Index=all'], order.join(' '));
  assert.ok(!order.includes('Get=P'), 'Get=P left unsent by the budget');
  assert.ok(states(F('relay', 'r1', 'readonly')).length > 0, 'the relays published');
  assert.equal(gladys.fake.lastState(F('meter', 'ti1', 'energy-index')), 12345.678);
  assert.deepEqual(states(TIC('apparent-power')), []);
  assert.deepEqual(states(POST(1)), [], 'never 0 for a post not read');
  assert.match(message(gladys), /Not read this time .*teleinformation, posts/);
  app.stop();
});

test('a three-phase or standard-mode teleinformation is said in the status, then cleared', async () => {
  const world = hisRt2();
  world.fixtures.set('TI', { ...GET_TI, IINST: '', IINST1: '004', IINST2: '003', IINST3: '002' });
  const config = { ...CONFIG, extensions: 'TIC' };
  const { app, gladys, start, wait } = await setup({ world, config });
  await start();
  assert.match(
    message(gladys),
    /Three-phase teleinformation: the current \(IINST1-3\) is not read/,
  );
  assert.match(message(gladys, 'fr'), /Téléinformation triphasée/);
  world.fixtures.set('TI', { product: 'EcoDevices_RT', status: 'Success', SINSTS: '00870' });
  await wait(15 * SECOND);
  assert.match(message(gladys), /standard mode of a Linky\?/);
  world.fixtures.set('TI', GET_TI);
  await wait(15 * SECOND);
  assert.doesNotMatch(message(gladys), /Three-phase|standard mode/);
  world.fixtures.set('TI', { product: 'EcoDevices_RT', status: 'Success', SINSTS: '00870' });
  await wait(15 * SECOND);
  await app.configUpdated({ ...config, extensions: '' });
  await wait(15 * SECOND);
  assert.doesNotMatch(message(gladys), /standard mode/, 'TIC unlisted: no longer said');
  app.stop();
});
