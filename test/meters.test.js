// -----------------------------------------------------------------------------
// The indexes end to end: pulse counters as configured (electricity read in
// Wh, published in kWh; water; gas), teleinformation in kWh (Wh read,
// confirmed on a real RT2), clamps never offered while their unit is not
// confirmed, each through its guard: never 0, never lower, a jump or a
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
const C3ID = F('meter', 'c3', 'energy-index');
const C4ID = F('meter', 'c4', 'energy-index');
const C1 = F('meter', 'c1', 'water-index');
const MCONFIG = { ...CONFIG, counters: 'C3:electricity:wh, C4:electricity:wh' };
const setupM = (options) => setup({ config: MCONFIG, ...options });
const meter = (code, feature = 'energy-index', id = `id-${code}`) =>
  created('meter', code, { feature, id });

test('electricity counters in kWh (Wh read), /data first, with their device', async () => {
  const devices = [meter('c3'), meter('c4')];
  const { app, gladys, start, store } = await setupM({ devices });
  await start();
  assert.equal(gladys.fake.lastState(C3ID), 12345.678);
  assert.equal(gladys.fake.lastState(C4ID), 456.789);
  assert.equal(store.data.meters.c3.device, 'id-c3');
  assert.equal(store.data.meters.c3.last.value, 12345.678);
  assert.equal(store.data.meters.c3.feature, 'energy-index');
  app.stop();
});

test('an index at 0 or unreadable is never published; Gladys keeps the last one', async () => {
  const world = fakeRt2();
  const devices = [meter('c3')];
  const { app, gladys, start, wait, states } = await setupM({ world, devices });
  await start();
  world.C[3] = 0;
  await wait(15 * SECOND);
  world.C[3] = 'ABCDEF';
  await wait(15 * SECOND);
  world.C[3] = null;
  await wait(15 * SECOND);
  assert.ok(
    states(C3ID).every((v) => v === 12345.678),
    states(C3ID).join(','),
  );
  assert.doesNotMatch(message(gladys), /held back/);
  app.stop();
});

test('a drop is held (the last value sent again), said, and taken only after two clicks', async () => {
  const world = fakeRt2();
  const devices = [meter('c3')];
  const { app, gladys, start, wait, states, store } = await setupM({ world, devices });
  await start();
  world.C[3] = 1_000_000;
  await wait(15 * SECOND);
  assert.ok(
    states(C3ID).every((v) => v === 12345.678),
    'never lower',
  );
  assert.match(
    message(gladys),
    /Index held back, not sent to Gladys: C3 12,345\.678 → 1,000 kWh \(drop\)/,
  );
  assert.match(message(gladys, 'fr'), /C3 12\s345,678 → 1\s000 kWh \(baisse\)/);
  assert.equal(store.data.meters.c3.held.direction, 'down');
  const first = await gladys.fake.action('accept_held_index', {});
  assert.match(first.data.message.en, /Held back: C3 12,345\.678 → 1,000 kWh/);
  const tooSoon = await gladys.fake.action('accept_held_index', {});
  assert.match(tooSoon.data.message.en, /Held back/, 'a second click within 3 s lists again');
  await wait(4 * SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.match(second.data.message.en, /Accepted, sent at the next read: C3/);
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(C3ID), 1000);
  assert.doesNotMatch(message(gladys), /held back/);
  app.stop();
});

test('a jump is held whatever the time, never confirmed by repetition; two clicks take it', async () => {
  const world = fakeRt2();
  const devices = [meter('c4')];
  const { app, gladys, start, wait, states } = await setupM({ world, devices });
  await start();
  // 1000 kWh in 15 s: no home draws that.
  world.C[4] += 1_000_000_000;
  for (let i = 0; i < 8; i += 1) await wait(15 * SECOND);
  assert.ok(states(C4ID).every((v) => v === 456.789));
  assert.match(message(gladys), /C4 456\.789 → 1,000,456\.789 kWh \(jump\)/);
  await gladys.fake.action('accept_held_index', {});
  await wait(5 * SECOND);
  const done = await gladys.fake.action('accept_held_index', {});
  assert.match(done.data.message.en, /Accepted/);
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(C4ID), 1000456.789);
  app.stop();
});

test('nothing held: the action says so; a held value that moved between the clicks is not taken', async () => {
  const world = fakeRt2();
  const devices = [meter('c3')];
  const { app, gladys, start, wait } = await setupM({ world, devices });
  await start();
  const none = await gladys.fake.action('accept_held_index', {});
  assert.match(none.data.message.en, /No index is held back/);
  world.C[3] = 5_000_000;
  await wait(15 * SECOND);
  await gladys.fake.action('accept_held_index', {});
  world.C[3] = 3_000_000;
  await wait(15 * SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.match(second.data.message.en, /Changed since the first click, not accepted.*C3/);
  app.stop();
});

test('the held value survives a restart; the acceptance does not', async () => {
  const world = fakeRt2();
  const devices = [meter('c3')];
  const first = await setupM({ world, devices });
  await first.start();
  world.C[3] = 1_000_000;
  await first.wait(15 * SECOND);
  await first.gladys.fake.action('accept_held_index', {});
  await first.app.shutdown();
  const second = await setupM({ world, devices, store: first.store, clock: first.clock });
  await second.wait(5 * SECOND);
  await second.start();
  const answer = await second.gladys.fake.action('accept_held_index', {});
  assert.match(answer.data.message.en, /Held back: C3/, 'a new first click after a restart');
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
      c3: {
        feature: 'energy-index',
        device: 'old-device',
        last: { value: 99_999, at: START - 1000 },
        held: null,
      },
    },
  };
  const devices = [meter('c3', 'energy-index', 'new-device')];
  const { app, gladys, start, wait } = await setupM({ world, devices, store });
  await start();
  assert.equal(gladys.fake.lastState(C3ID), 12345.678, 'the old reference is not this device’s');
  assert.equal(store.data.meters.c3.device, 'new-device');
  await gladys.fake.deviceDeleted(devices[0]);
  await wait(100);
  assert.equal(store.data.meters.c3, undefined);
  app.stop();
});

test('/data that cannot be written: no index sent (the guard first)', async () => {
  const devices = [meter('c3')];
  const store = memoryStore();
  store.data = boundMemory();
  store.fail = true;
  const { app, gladys, start } = await setupM({ devices, store });
  await start();
  assert.equal(gladys.fake.lastState(C3ID), undefined);
  app.stop();
});

test('/data unreadable: no index published, nothing written over it', async () => {
  const devices = [meter('c3')];
  const store = memoryStore();
  store.data = boundMemory();
  store.unreadable = true;
  const { app, gladys, start } = await setupM({ devices, store });
  await start();
  assert.equal(gladys.fake.lastState(C3ID), undefined);
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
  const { app, gladys, start } = await setupM({
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
  const { app, gladys, start, wait, store } = await setupM({
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
  const devices = [meter('c3')];
  const { app, gladys, wait, start, states } = await setupM({ world, devices, clock });
  await start();
  shift = 24 * 3600 * SECOND;
  // 500 kWh more: fine over a day (100 kW), not over 15 s.
  world.C[3] += 500_000;
  await wait(15 * SECOND);
  assert.ok(
    states(C3ID).every((v) => v === 12345.678),
    'held: the wall clock is not the session',
  );
  assert.match(message(gladys), /held back/);
  app.stop();
});

test('another box at the configured address: no index published onto its devices', async () => {
  const world = fakeRt2();
  const devices = [meter('c3')];
  const store = memoryStore();
  store.data = boundMemory({ host: '192.168.1.99' });
  const { app, gladys, start } = await setupM({ world, devices, store });
  await start();
  assert.equal(gladys.fake.lastState(C3ID), undefined);
  assert.match(message(gladys), /created for the Eco-Devices at another address/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  app.stop();
});

test('teleinformation published in kWh (Wh read); clamps neither offered nor published while their unit is unconfirmed', async () => {
  const world = fakeRt2();
  world.TORE[17] = 1_846_258;
  const devices = [meter('ti1'), meter('tore1'), meter('tore17')];
  const { app, gladys, start, wait } = await setupM({ world, devices });
  await start();
  await wait(15 * SECOND);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(!ids.some((id) => /meter:tore/.test(id)), ids.join(' '));
  assert.ok(ids.includes('ext:rt2:meter:ti2'), ids.join(' '));
  assert.equal(gladys.fake.lastState(F('meter', 'ti1', 'energy-index')), 12345.678);
  assert.equal(gladys.fake.lastState(F('meter', 'tore1', 'energy-index')), undefined);
  assert.equal(gladys.fake.lastState(F('meter', 'tore17', 'energy-index')), undefined);
  assert.match(message(gladys), /2 clamp index\(es\) read but not offered/);
  assert.match(message(gladys, 'fr'), /leur unité \(Wh ou kWh\) n’est pas encore confirmée/);
  app.stop();
});

test('a counter whose unit changes after its index was published: never published again', async () => {
  const world = fakeRt2();
  const devices = [meter('c3')];
  const { app, gladys, start, wait, states, store } = await setupM({ world, devices });
  await start();
  assert.equal(gladys.fake.lastState(C3ID), 12345.678);
  assert.equal(store.data.meters.c3.unit, 'wh');
  await app.configUpdated({ ...MCONFIG, counters: 'C3:electricity:kwh, C4:electricity:wh' });
  for (let i = 0; i < 4; i += 1) await wait(15 * SECOND);
  assert.ok(
    states(C3ID).every((v) => v === 12345.678),
    states(C3ID).join(','),
  );
  assert.match(message(gladys), /Unit of a counter changed .*C3/);
  const accept = await gladys.fake.action('accept_held_index', {});
  assert.match(accept.data.message.en, /No index is held back/, 'nothing to accept, never a jump');
  // Put back: published again from the same reference.
  await app.configUpdated(MCONFIG);
  world.C[3] += 1000;
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(C3ID), 12346.678);
  assert.doesNotMatch(message(gladys), /Unit of a counter changed/);
  app.stop();
});

test('the unit kept after a restart: a unit changed while stopped is caught too', async () => {
  const devices = [meter('c3')];
  const first = await setupM({ devices });
  await first.start();
  await first.app.shutdown();
  const second = await setup({
    config: { ...MCONFIG, counters: 'C3:electricity:kwh' },
    devices,
    store: first.store,
    clock: first.clock,
  });
  await second.wait(15 * SECOND);
  await second.start();
  await second.wait(15 * SECOND);
  assert.match(message(second.gladys), /Unit of a counter changed .*C3/);
  assert.ok(second.states(C3ID).length === 0, 'nothing published by the second run');
  second.app.stop();
});
