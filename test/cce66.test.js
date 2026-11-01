// -----------------------------------------------------------------------------
// The answers of a real Eco-Devices RT2 (cce66, community thread t/11448,
// post 7, 2026-10-31), copied as he gave them, his API key removed by him:
// `Get=R`, `Index=all` and `Get=FP`. What they taught:
// - `Index_TI<n>` = 4294967295 (0xFFFFFFFF): an entry with nothing behind it,
//   never an index (never offered, published, nor held as a jump);
// - the teleinformation index is in Wh (TI1 = the index of his Eco-Devices 3
//   on the same Linky, 143 Wh apart): offered and published in kWh;
// - the clamps go up to `Index_TORE20`; their unit is still unconfirmed;
// - `Get=FP` answers numbers (0), not mode texts: never published as a mode,
//   Eco and Comfort refused there, Off and Frost protection still sent.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILOT, UNIT_CONFIRMED } from '../src/constants.js';
import {
  checkEnvelope,
  indexKey,
  indexNumber,
  kindOf,
  meterOf,
  valueOf,
  zoneIsNumber,
} from '../src/rt2/model.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const GET_R = {
  product: 'EcoDevices_RT',
  status: 'Success',
  R1: 0,
  R2: 0,
  R3: 0,
  R4: 0,
  R5: 0,
  R6: 0,
  R7: 0,
  R8: 0,
  R9: 0,
  R10: 0,
};

const INDEX_ALL = {
  product: 'EcoDevices_RT',
  status: 'Success',
  Index_C1: 149399,
  Index_C2: 0,
  Index_C3: 0,
  Index_C4: 0,
  Index_C5: 0,
  Index_C6: 0,
  Index_C7: 0,
  Index_C8: 0,
  Index_C9: 0,
  Index_C10: 0,
  Index_C11: 0,
  Index_C12: 0,
  Index_TORE1: 271232,
  Index_TORE2: 660664,
  Index_TORE3: 1654075,
  Index_TORE4: 0,
  Index_TORE5: 0,
  Index_TORE6: 0,
  Index_TORE7: 0,
  Index_TORE8: 0,
  Index_TORE9: 0,
  Index_TORE10: 0,
  Index_TORE11: 0,
  Index_TORE12: 0,
  Index_TORE13: 0,
  Index_TORE14: 0,
  Index_TORE15: 0,
  Index_TORE16: 0,
  Index_TORE17: 1846258,
  Index_TORE18: 8331781,
  Index_TORE19: 0,
  Index_TORE20: 227258,
  Index_TI1: 132533718,
  Index_TI2: 0,
  Index_TI3: 4294967295,
  Index_TI4: 4294967295,
  Index_TI5: 4294967295,
  Index_TI6: 4294967295,
  Index_TI7: 4294967295,
};

const GET_FP = {
  product: 'EcoDevices_RT',
  status: 'Success',
  'FP1 Zone 1': 0,
  'FP1 Zone 2': 0,
  'FP1 Zone 3': 0,
  'FP1 Zone 4': 0,
  'FP2 Zone 1': 0,
  'FP2 Zone 2': 0,
  'FP2 Zone 3': 0,
  'FP2 Zone 4': 0,
};

/** The fake Eco-Devices answering his reads as his RT2 did. */
function hisRt2() {
  const world = fakeRt2();
  world.fixtures.set('R', GET_R);
  world.fixtures.set('all', INDEX_ALL);
  world.fixtures.set('FP', GET_FP);
  return world;
}

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const meter = (code) => created('meter', code, { feature: 'energy-index', id: `id-${code}` });
const TI = (n) => F('meter', `ti${n}`, 'energy-index');

test('his answers: the envelope is an Eco-Devices RT2 one, nothing to relax', () => {
  for (const json of [GET_R, INDEX_ALL, GET_FP])
    assert.deepEqual(checkEnvelope(json), { ok: true });
});

test('his answers, read: 4294967295 is no index; TORE20 is a clamp; FP 0 is no mode', () => {
  assert.equal(indexNumber(4294967295), undefined);
  assert.equal(indexNumber('4294967295'), undefined);
  assert.equal(indexNumber(4294967294), 4294967294, 'only that one value');
  for (const n of [3, 4, 5, 6, 7]) {
    assert.equal(meterOf(`ti${n}`, INDEX_ALL[indexKey(`ti${n}`)]).value, undefined);
  }
  assert.equal(meterOf('ti1', INDEX_ALL.Index_TI1).value, 132533.718, 'Wh read, kWh published');
  assert.equal(kindOf('tore20'), 'meter');
  assert.equal(kindOf('tore21'), undefined);
  assert.equal(indexKey('tore20'), 'Index_TORE20');
  assert.deepEqual(UNIT_CONFIRMED, { ti: true, tore: false });
  for (let n = 1; n <= 8; n += 1) {
    assert.equal(zoneIsNumber(GET_FP, n), true);
    assert.equal(valueOf(GET_FP, 'pilot-wire', n), undefined, `FP${n}: 0 is never Comfort`);
  }
});

test('his RT2: 10 relays, 12 inputs, TI1 offered and published in kWh, TI2 to TI7 and the clamps not', async () => {
  const devices = [meter('ti1'), meter('ti3')];
  const { app, gladys, start, wait, states } = await setup({ world: hisRt2(), devices });
  await start();
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys), /10 relay\(s\), 12 input\(s\)/);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes('ext:rt2:meter:ti1'), ids.join(' '));
  for (const n of [2, 4, 5, 6, 7]) assert.ok(!ids.includes(`ext:rt2:meter:ti${n}`), `TI${n}`);
  assert.ok(!ids.some((id) => /meter:tore/.test(id)), 'clamps: unit not confirmed');
  // TORE1, 2, 3, 17, 18, 20: read, counted, not offered.
  assert.match(message(gladys), /6 clamp index\(es\) read but not offered/);
  assert.equal(gladys.fake.lastState(TI(1)), 132533.718);
  assert.deepEqual(states(TI(3)), [], 'an absent entry is never published');
  assert.doesNotMatch(message(gladys), /held back/);
  app.stop();
});

test('his RT2: an entry turning absent (4294967295) is never a jump, Gladys keeps the last index', async () => {
  const world = hisRt2();
  const devices = [meter('ti1')];
  const { app, gladys, start, wait, states, store } = await setup({ world, devices });
  await start();
  assert.equal(gladys.fake.lastState(TI(1)), 132533.718);
  world.fixtures.set('all', { ...INDEX_ALL, Index_TI1: 4294967295 });
  await wait(15 * SECOND);
  await wait(15 * SECOND);
  assert.ok(
    states(TI(1)).every((v) => v === 132533.718),
    states(TI(1)).join(','),
  );
  assert.equal(store.data.meters.ti1.held ?? null, null);
  assert.doesNotMatch(message(gladys), /held back/);
  const accept = await gladys.fake.action('accept_held_index', {});
  assert.match(accept.data.message.en, /No index is held back/);
  // Back to a real index: published again from the same reference.
  world.fixtures.set('all', { ...INDEX_ALL, Index_TI1: 132534718 });
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(TI(1)), 132534.718);
  app.stop();
});

test('his X-4FP answer (numbers): no mode published, said; Eco and Comfort refused unsent, Off still goes', async () => {
  const devices = [created('pilot-wire', 'fp1'), created('pilot-wire', 'fp5')];
  const world = hisRt2();
  const { app, gladys, start, cmd, wait, states } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1-FP8', allow_heating_modes: true },
  });
  await start();
  await wait(15 * SECOND);
  assert.deepEqual(states(F('pilot-wire', 'fp1', 'mode')), []);
  assert.deepEqual(states(F('pilot-wire', 'fp5', 'mode')), []);
  assert.match(message(gladys), /answering a number instead of a mode .*FP1/);
  assert.match(message(gladys, 'fr'), /répondent un nombre au lieu d’un mode/);
  for (const mode of [PILOT.COMFORT, PILOT.ECO, PILOT.COMFORT_1, PILOT.COMFORT_2]) {
    const refused = await cmd(devices[0], F('pilot-wire', 'fp1', 'mode'), mode);
    assert.equal(refused.success, false);
    assert.match(refused.error, /répond un nombre au lieu d’un mode/);
  }
  assert.equal(world.writes().length, 0, 'nothing sent');
  const off = await cmd(devices[1], F('pilot-wire', 'fp5', 'mode'), PILOT.OFF);
  assert.match(world.writes().at(-1).path, /SetFP05=3$/, 'a protective Off is never refused');
  assert.equal(off.success, false, 'not confirmed: the zone reads a number');
  assert.deepEqual(states(F('pilot-wire', 'fp5', 'mode')), []);
  app.stop();
});

test('a zone answering a mode text again is understood again: Comfort then goes', async () => {
  const devices = [created('pilot-wire', 'fp1')];
  const world = hisRt2();
  const { app, gladys, start, cmd, wait } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1', allow_heating_modes: true },
  });
  await start();
  assert.match(message(gladys), /answering a number/);
  world.fixtures.delete('FP');
  await wait(15 * SECOND);
  assert.doesNotMatch(message(gladys), /answering a number/);
  assert.equal(gladys.fake.lastState(F('pilot-wire', 'fp1', 'mode')), PILOT.OFF);
  const comfort = await cmd(devices[0], F('pilot-wire', 'fp1', 'mode'), PILOT.COMFORT);
  assert.equal(comfort.success, true, comfort.error);
  assert.equal(world.FP[1], 'Confort');
  app.stop();
});

test('a read back showing a mode text clears the number at once: Comfort goes before the next round', async () => {
  const devices = [created('pilot-wire', 'fp1')];
  const world = hisRt2();
  const { app, gladys, start, cmd } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1', allow_heating_modes: true },
  });
  await start();
  assert.match(message(gladys), /answering a number/);
  world.fixtures.delete('FP');
  const reads = world.reads().length;
  const off = await cmd(devices[0], F('pilot-wire', 'fp1', 'mode'), PILOT.OFF);
  assert.equal(off.success, true, off.error);
  const comfort = await cmd(devices[0], F('pilot-wire', 'fp1', 'mode'), PILOT.COMFORT);
  assert.equal(comfort.success, true, comfort.error);
  assert.ok(
    !world
      .reads()
      .slice(reads)
      .some((r) => /Get=D/.test(r.path)),
    'no round in between',
  );
  app.stop();
});
