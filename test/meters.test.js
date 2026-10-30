// -----------------------------------------------------------------------------
// The indexes end to end: teleinformation and clamps in kWh, pulse counters
// as configured, each through its guard: never 0, never lower, a jump or a
// drop held until two clicks of "Accept the held index", kept in /data with
// the device it belongs to, dated on the session clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/store.js';
import { testClock } from './kit/index.mjs';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, START, boundMemory, created, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const TI1 = F('meter', 'ti1', 'energy-index');
const TORE1 = F('meter', 'tore1', 'energy-index');
const C1 = F('meter', 'c1', 'water-index');
const meter = (code, feature = 'energy-index', id = `id-${code}`) =>
  created('meter', code, { feature, id });

test('a teleinformation index and a clamp in kWh (Wh read), /data first, with their device', async () => {
  const devices = [meter('ti1'), meter('tore1')];
  const { app, gladys, start, store } = await setup({ devices });
  await start();
  assert.equal(gladys.fake.lastState(TI1), 12345.678);
  assert.equal(gladys.fake.lastState(TORE1), 456.789);
  assert.equal(store.data.meters.ti1.device, 'id-ti1');
  assert.equal(store.data.meters.ti1.last.value, 12345.678);
  assert.equal(store.data.meters.ti1.feature, 'energy-index');
  app.stop();
});

test('an index at 0 or unreadable is never published; Gladys keeps the last one', async () => {
  const world = fakeRt2();
  const devices = [meter('ti1')];
  const { app, gladys, start, wait, states } = await setup({ world, devices });
  await start();
  world.TI[1] = 0;
  await wait(15 * SECOND);
  world.TI[1] = 'ABCDEF';
  await wait(15 * SECOND);
  world.TI[1] = null;
  await wait(15 * SECOND);
  assert.ok(
    states(TI1).every((v) => v === 12345.678),
    states(TI1).join(','),
  );
  assert.doesNotMatch(message(gladys), /held back/);
  app.stop();
});

test('a drop is held (the last value sent again), said, and taken only after two clicks', async () => {
  const world = fakeRt2();
  const devices = [meter('ti1')];
  const { app, gladys, start, wait, states, store } = await setup({ world, devices });
  await start();
  world.TI[1] = 1_000_000;
  await wait(15 * SECOND);
  assert.ok(
    states(TI1).every((v) => v === 12345.678),
    'never lower',
  );
  assert.match(
    message(gladys),
    /Index held back, not sent to Gladys: TI1 12,345\.678 → 1,000 kWh \(drop\)/,
  );
  assert.match(message(gladys, 'fr'), /TI1 12\s345,678 → 1\s000 kWh \(baisse\)/);
  assert.equal(store.data.meters.ti1.held.direction, 'down');
  const first = await gladys.fake.action('accept_held_index', {});
  assert.match(first.data.message.en, /Held back: TI1 12,345\.678 → 1,000 kWh/);
  const tooSoon = await gladys.fake.action('accept_held_index', {});
  assert.match(tooSoon.data.message.en, /Held back/, 'a second click within 3 s lists again');
  await wait(4 * SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.match(second.data.message.en, /Accepted, sent at the next read: TI1/);
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(TI1), 1000);
  assert.doesNotMatch(message(gladys), /held back/);
  app.stop();
});

test('a jump is held whatever the time, never confirmed by repetition; two clicks take it', async () => {
  const world = fakeRt2();
  const devices = [meter('tore1')];
  const { app, gladys, start, wait, states } = await setup({ world, devices });
  await start();
  // 1000 kWh in 15 s: no home draws that.
  world.TORE[1] += 1_000_000_000;
  for (let i = 0; i < 8; i += 1) await wait(15 * SECOND);
  assert.ok(states(TORE1).every((v) => v === 456.789));
  assert.match(message(gladys), /TORE1 456\.789 → 1,000,456\.789 kWh \(jump\)/);
  await gladys.fake.action('accept_held_index', {});
  await wait(5 * SECOND);
  const done = await gladys.fake.action('accept_held_index', {});
  assert.match(done.data.message.en, /Accepted/);
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(TORE1), 1000456.789);
  app.stop();
});

test('nothing held: the action says so; a held value that moved between the clicks is not taken', async () => {
  const world = fakeRt2();
  const devices = [meter('ti1')];
  const { app, gladys, start, wait } = await setup({ world, devices });
  await start();
  const none = await gladys.fake.action('accept_held_index', {});
  assert.match(none.data.message.en, /No index is held back/);
  world.TI[1] = 5_000_000;
  await wait(15 * SECOND);
  await gladys.fake.action('accept_held_index', {});
  world.TI[1] = 3_000_000;
  await wait(15 * SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.match(second.data.message.en, /Changed since the first click, not accepted.*TI1/);
  app.stop();
});

test('the held value survives a restart; the acceptance does not', async () => {
  const world = fakeRt2();
  const devices = [meter('ti1')];
  const first = await setup({ world, devices });
  await first.start();
  world.TI[1] = 1_000_000;
  await first.wait(15 * SECOND);
  await first.gladys.fake.action('accept_held_index', {});
  await first.app.shutdown();
  const second = await setup({ world, devices, store: first.store, clock: first.clock });
  await second.wait(5 * SECOND);
  await second.start();
  const answer = await second.gladys.fake.action('accept_held_index', {});
  assert.match(answer.data.message.en, /Held back: TI1/, 'a new first click after a restart');
  await second.wait(15 * SECOND);
  assert.match(message(second.gladys), /held back/);
  second.app.stop();
});

test('a device created again (another id) starts afresh; a deleted one takes its state with it', async () => {
  const world = fakeRt2();
  const store = memoryStore();
  store.data = {
    ...boundMemory(),
    meters: {
      ti1: {
        feature: 'energy-index',
        device: 'old-device',
        last: { value: 99_999, at: START - 1000 },
        held: null,
      },
    },
  };
  const devices = [meter('ti1', 'energy-index', 'new-device')];
  const { app, gladys, start, wait } = await setup({ world, devices, store });
  await start();
  assert.equal(gladys.fake.lastState(TI1), 12345.678, 'the old reference is not this device’s');
  assert.equal(store.data.meters.ti1.device, 'new-device');
  await gladys.fake.deviceDeleted(devices[0]);
  await wait(100);
  assert.equal(store.data.meters.ti1, undefined);
  app.stop();
});

test('/data that cannot be written: no index sent (the guard first)', async () => {
  const devices = [meter('ti1')];
  const store = memoryStore();
  store.data = boundMemory();
  store.fail = true;
  const { app, gladys, start } = await setup({ devices, store });
  await start();
  assert.equal(gladys.fake.lastState(TI1), undefined);
  app.stop();
});

test('/data unreadable: no index published, nothing written over it', async () => {
  const devices = [meter('ti1')];
  const store = memoryStore();
  store.data = boundMemory();
  store.unreadable = true;
  const { app, gladys, start } = await setup({ devices, store });
  await start();
  assert.equal(gladys.fake.lastState(TI1), undefined);
  assert.equal(store.saves, 0);
  app.stop();
});

test('pulse counters: only those configured, water litres -> m³, gas m³, electricity Wh -> kWh', async () => {
  const world = fakeRt2();
  world.C[2] = 4567;
  world.C[3] = 89_000;
  const devices = [
    meter('c1', 'water-index'),
    meter('c2', 'gas-index'),
    meter('c3', 'energy-index'),
  ];
  const { app, gladys, start } = await setup({
    world,
    devices,
    config: { ...CONFIG, counters: 'C1:water:l, C2:gas:m3, C3:electricity:wh' },
  });
  await start();
  assert.equal(gladys.fake.lastState(C1), 123.456);
  assert.equal(gladys.fake.lastState(F('meter', 'c2', 'gas-index')), 4567);
  assert.equal(gladys.fake.lastState(F('meter', 'c3', 'energy-index')), 89);
  const c1 = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:meter:c1');
  assert.equal(c1.features[0].category, 'volume-sensor');
  assert.equal(c1.features[0].unit, 'cubicmeter');
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(!ids.includes('ext:rt2:meter:c4'));
  app.stop();
});

test('a counter given another type: a new feature, its own reference (never the old one)', async () => {
  const world = fakeRt2();
  const devices = [meter('c1', 'water-index')];
  const { app, gladys, start, wait, store } = await setup({
    world,
    devices,
    config: { ...CONFIG, counters: 'C1:water:l' },
  });
  await start();
  assert.equal(store.data.meters.c1.feature, 'water-index');
  await app.configUpdated({ ...CONFIG, counters: 'C1:gas:l' });
  await wait(15 * SECOND);
  const c1 = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:meter:c1');
  assert.deepEqual(
    c1.features.map((f) => f.external_id),
    [F('meter', 'c1', 'gas-index'), C1],
    'the new feature, the old one kept',
  );
  assert.equal(gladys.fake.lastState(F('meter', 'c1', 'gas-index')), undefined, 'not created yet');
  app.stop();
});

test('session clock: a wall clock jump of a day never widens the margin of a jump', async () => {
  const base = testClock({ start: START });
  let shift = 0;
  const clock = {
    ...base,
    now: () => base.now() + shift,
    monotonic: base.monotonic,
    timers: base.timers,
    advance: (ms) => base.advance(ms),
    get elapsed() {
      return base.elapsed;
    },
  };
  const world = fakeRt2();
  const devices = [meter('ti1')];
  const { app, gladys, wait, start, states } = await setup({ world, devices, clock });
  await start();
  shift = 24 * 3600 * SECOND;
  // 500 kWh more: fine over a day (100 kW), not over 15 s.
  world.TI[1] += 500_000;
  await wait(15 * SECOND);
  assert.ok(
    states(TI1).every((v) => v === 12345.678),
    'held: the wall clock is not the session',
  );
  assert.match(message(gladys), /held back/);
  app.stop();
});

test('another box at the configured address: no index published onto its devices', async () => {
  const world = fakeRt2();
  const devices = [meter('ti1')];
  const store = memoryStore();
  store.data = boundMemory({ host: '192.168.1.99' });
  const { app, gladys, start } = await setup({ world, devices, store });
  await start();
  assert.equal(gladys.fake.lastState(TI1), undefined);
  assert.match(message(gladys), /created for the Eco-Devices at another address/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  app.stop();
});
