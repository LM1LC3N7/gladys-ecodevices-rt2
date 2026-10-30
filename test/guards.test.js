// -----------------------------------------------------------------------------
// One test per guard the r1 review's mutants left alive (m4): values of another
// address, the verdict at start, the checks right before the first byte (app
// and transport), a relay removed between click and send, the second click of
// "Accept the held index", the freshness at device creation, /data unreadable,
// "Attach" offline, the limits of the index guard, the default units.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { parseCounters } from '../src/config.js';
import { FEATURES, GUARD_LIMITS, PILOT, TIMINGS } from '../src/constants.js';
import { request } from '../src/rt2/http.js';
import { memoryStore } from '../src/store.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import {
  CONFIG,
  F,
  SECOND,
  boundMemory,
  created,
  settle,
  setup,
  trustProduct,
} from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });

test('I12: devices made at another address: none of the values read here reach them', async () => {
  const devices = [created('relay', 'r1'), created('input', 'd1')];
  const world = fakeRt2();
  world.R[1] = 1;
  world.D[1] = 1;
  const store = memoryStore(boundMemory({ host: '192.168.1.99' }));
  const { app, gladys, start, wait } = await setup({ world, devices, store });
  await start();
  await wait(15 * SECOND);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), undefined);
  assert.equal(gladys.fake.lastState(F('input', 'd1', 'state')), undefined);
  app.stop();
});

test('I3: devices made at another address: a click before the first round is refused', async () => {
  const devices = [switchOf('r1')];
  const world = fakeRt2();
  world.latency = 3 * SECOND;
  const store = memoryStore(boundMemory({ host: '192.168.1.99' }));
  const { app, gladys, act, config } = await setup({
    world,
    devices,
    store,
    config: { ...CONFIG, relays: 'R1' },
  });
  void config;
  app.connected({ ...CONFIG, relays: 'R1' });
  await settle();
  const ack = await act(gladys.fake.setValue(devices[0], devices[0].features[0], 1));
  assert.equal(ack.success, false);
  assert.match(ack.error, /autre adresse/);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('P8: an Off waiting in the lane is not sent once another box was found', async () => {
  const devices = [switchOf('r1'), switchOf('r2')];
  const world = fakeRt2();
  world.R[1] = 1;
  world.R[2] = 1;
  const { app, start, act, gladys } = await setup({
    world,
    devices,
    config: { ...CONFIG, relays: 'R1, R2' },
  });
  await start();
  trustProduct(app);
  world.latency = (r) => (/ClearR=01/.test(r.path) ? 600 : 20);
  const first = gladys.fake.setValue(devices[0], devices[0].features[0], 0);
  const second = gladys.fake.setValue(devices[1], devices[1].features[0], 0);
  const flip = (async () => {
    while (world.writes().length === 0) await new Promise((r) => setImmediate(r));
    app.verdict = 'different';
  })();
  const [, b] = await act(Promise.all([first, second, flip]));
  assert.equal(b.success, false);
  assert.deepEqual(
    world
      .writes()
      .filter((w) => w.sentAt !== undefined)
      .map((w) => w.path.split('&').pop()),
    ['ClearR=01'],
    'the second Off never left',
  );
  app.stop();
});

test('P9: a guard sent again is checked right before its first byte (another box found)', async () => {
  const devices = [switchOf('r1')];
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, start, cmd, act } = await setup({
    world,
    devices,
    config: { ...CONFIG, relays: 'R1' },
  });
  await start();
  trustProduct(app);
  world.ignoreWrites = true;
  await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  const guard = app.guards.get('r1');
  assert.ok(guard);
  // A slow request holds the lane while the resend waits; then another box is found.
  world.latency = (r) => (/Get=D/.test(r.path) ? 500 : 20);
  const slow = app.client.read('Get=D').catch(() => {});
  const sent = () => world.writes().filter((w) => w.sentAt !== undefined).length;
  const before = sent();
  app.resendGuard(guard);
  app.verdict = 'different';
  await act(slow);
  await act(new Promise((r) => app.timers.setTimeout(r, 1000)));
  assert.equal(sent(), before, 'the resend never left');
  app.stop();
});

test('P5: a relay removed from the list between its click and its turn is never switched on', async () => {
  const devices = [switchOf('r1'), switchOf('r2')];
  const world = fakeRt2();
  const { app, start, act, gladys } = await setup({
    world,
    devices,
    config: { ...CONFIG, relays: 'R1, R2' },
  });
  await start();
  trustProduct(app);
  world.latency = (r) => (/SetR=01/.test(r.path) ? 500 : 20);
  const first = gladys.fake.setValue(devices[0], devices[0].features[0], 1);
  const second = gladys.fake.setValue(devices[1], devices[1].features[0], 1);
  const unlist = (async () => {
    while (world.writes().length === 0) await new Promise((r) => setImmediate(r));
    await app.configUpdated({ ...CONFIG, relays: 'R1' });
  })();
  const [, b] = await act(Promise.all([first, second, unlist]));
  assert.equal(b.success, false);
  assert.match(b.error, /lecture seule/);
  assert.equal(world.R[2], 0);
  app.stop();
});

test('H2 / H3: the transport checks right before the first byte (a refusal, a deadline passed)', async (t) => {
  const seen = [];
  const server = createServer((socket) => {
    socket.on('data', (chunk) => seen.push(chunk.toString('latin1')));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const refused = await request(
    { hostname: '127.0.0.1', port, path: '/api/xdevices.json?SetR=01' },
    {
      deadline: performance.now() + 2000,
      maxBytes: 1024,
      beforeSend: () => {
        throw Object.assign(new Error('superseded'), { code: 'late' });
      },
    },
  ).catch((err) => err);
  assert.equal(refused.code, 'late');
  const late = await request(
    { hostname: '127.0.0.1', port, path: '/api/xdevices.json?SetR=02' },
    {
      deadline: performance.now() + 30,
      maxBytes: 1024,
      beforeSend: () => {
        const until = performance.now() + 60;
        while (performance.now() < until);
      },
    },
  ).catch((err) => err);
  assert.equal(late.code, 'late');
  assert.equal(late.sent, false);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, [], 'not a byte left');
});

const held = async () => {
  const devices = [created('meter', 'c3', { feature: FEATURES.ENERGY, id: 'd-c3' })];
  const world = fakeRt2();
  const ctx = await setup({
    world,
    devices,
    config: { ...CONFIG, counters: 'C3:electricity:wh' },
  });
  await ctx.start();
  world.C[3] = 1_000_000;
  await ctx.wait(15 * SECOND);
  assert.match(message(ctx.gladys), /held back/);
  return ctx;
};

test('X4: the second click of "Accept" in another session lists again', async () => {
  const { app, gladys, wait } = await held();
  await gladys.fake.action('accept_held_index', {});
  await app.configUpdated({ ...CONFIG, counters: 'C3:electricity:wh', host: '192.168.1.60:80' });
  await app.configUpdated({ ...CONFIG, counters: 'C3:electricity:wh', api_key: 'other-key' });
  await wait(4 * SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.doesNotMatch(second.data.message.en, /Accepted/);
  app.stop();
});

test('X10: the second click of "Accept" after 5 minutes lists again', async () => {
  const { app, gladys, wait } = await held();
  await gladys.fake.action('accept_held_index', {});
  await wait(TIMINGS.acceptWithin + SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.match(second.data.message.en, /Held back/);
  assert.doesNotMatch(second.data.message.en, /Accepted/);
  app.stop();
});

test('X5: a drop held again from another reference between the clicks is not taken', async () => {
  const { app, gladys, wait, world } = await held();
  await gladys.fake.action('accept_held_index', {});
  // Back to normal (a new reference), then the same low value again: from another reference.
  world.C[3] = 12_345_978;
  await wait(15 * SECOND);
  world.C[3] = 1_000_000;
  await wait(15 * SECOND);
  const second = await gladys.fake.action('accept_held_index', {});
  assert.match(second.data.message.en, /Changed since the first click/);
  app.stop();
});

test('X7: a device created long after the last read gets no old value', async () => {
  const device = created('relay', 'r1');
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, gladys, start } = await setup({ world, config: { ...CONFIG, poll_interval: 300 } });
  await start();
  const target = app.model.get('r1');
  app.model.set('r1', { ...target, at: target.at - 400 * SECOND });
  await gladys.fake.deviceCreated(device);
  await settle();
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), undefined);
  app.stop();
});

test('I5: /data unreadable, no device yet: the box read is not taken as owner', async () => {
  const store = memoryStore();
  store.unreadable = true;
  const { app, gladys, start, wait } = await setup({ store, fresh: true });
  await start();
  await wait(15 * SECOND);
  assert.match(message(gladys), /\/data cannot be read/);
  assert.equal(store.data, null);
  app.stop();
});

test('I11: "Attach" while the box does not answer: refused', async () => {
  const device = switchOf('r1');
  const world = fakeRt2();
  const store = memoryStore(boundMemory({ host: '192.168.1.99' }));
  const { app, gladys, start, wait } = await setup({ world, devices: [device], store });
  await start();
  world.refuseConnect = 99;
  await wait(15 * SECOND);
  const answer = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(answer.data.message.en, /No Eco-Devices read right now/);
  app.stop();
});

test('K4 / K5: the limits of the index guard; a counter without unit takes the first of its type', () => {
  assert.deepEqual(GUARD_LIMITS[FEATURES.ENERGY], { maxKw: 100, slackKwh: 0.5 });
  assert.deepEqual(GUARD_LIMITS[FEATURES.WATER], { maxKw: 10, slackKwh: 0.05 });
  assert.deepEqual(GUARD_LIMITS[FEATURES.GAS], { maxKw: 16, slackKwh: 0.05 });
  assert.deepEqual(
    [...parseCounters('C1:water, C2:gas, C3:electricity').counters],
    [
      ['c1', { type: 'water', unit: 'l' }],
      ['c2', { type: 'gas', unit: 'm3' }],
      ['c3', { type: 'electricity', unit: 'wh' }],
    ],
  );
  void PILOT;
});
