// -----------------------------------------------------------------------------
// Another GCE product at the address (an IPX800 V4 speaks the same API:
// SetR, ClearR, SetFPxx): no command reaches it, not even an Off, not after a
// restart. Every write waits for a read that left after its click (or 250 ms
// before it) and showed "product": "EcoDevices_RT"; an Off waits 1 s at most
// for it (unreadable is never "another product"). Any answer naming another
// product stops everything at once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILOT, TIMINGS } from '../src/constants.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const CFG = {
  ...CONFIG,
  relays: 'R1, R2',
  extensions: 'FP1',
  allow_heating_modes: true,
  poll_interval: 300,
};
const devicesOf = () => [
  created('relay', 'r1', { relayKind: 'switch' }),
  created('relay', 'r2', { relayKind: 'switch' }),
  created('pilot-wire', 'fp1'),
];
const tail = (path) => path.split('&').pop();
/** The writes an IPX800 took (the answers name it). */
const writesTo = (world, from) =>
  world
    .writes()
    .slice(from)
    .map((w) => tail(w.path));

test('w1: the box becomes an IPX800 between two rounds: no Off, no On, no Eco reaches it', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, cmd, gladys, store, wait } = await setup({ world, devices, config: CFG });
  await start();
  await wait(5 * SECOND);
  world.product = 'IPX800_V4';
  world.R[1] = 1;
  const before = world.writes().length;
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  const eco = await cmd(devices[2], F('pilot-wire', 'fp1', 'mode'), PILOT.ECO);
  assert.deepEqual(writesTo(world, before), [], 'nothing reached the IPX800');
  for (const ack of [off, on, eco]) {
    assert.equal(ack.success, false);
    assert.match(ack.error, /pas un Eco-Devices RT2 : rien n’a été envoyé/);
  }
  assert.match(message(gladys), /not an Eco-Devices RT2 \(it answers as "IPX800_V4"\)/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.deepEqual(store.data.foreign.product, 'IPX800_V4', 'kept in /data');
  assert.equal(app.guards.size, 0, 'the Off proven useless here is not kept');
  app.stop();
});

test('a write answered by another product: said, and nothing more goes there', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, cmd, act, gladys, wait } = await setup({ world, devices, config: CFG });
  await start();
  // The product read still says RT2 (the box swapped between it and the write).
  world.queue.push((r) =>
    /SetR=02/.test(r.path) ? { json: { product: 'IPX800_V4', status: 'Success' } } : undefined,
  );
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  assert.match(on.error, /un autre produit GCE a répondu \(« IPX800_V4 »\)/);
  const before = world.writes().length;
  const again = await act(gladys.fake.setValue(devices[1], devices[1].features[0], 1));
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(again.success, false);
  assert.equal(off.success, false);
  assert.equal(world.writes().length, before, 'nothing more sent');
  await wait(SECOND);
  assert.match(message(gladys), /not an Eco-Devices RT2/);
  app.stop();
});

test('a read back, a follow-up or a secondary group naming another product stops everything', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, gladys, wait, cmd } = await setup({
    world,
    devices,
    config: { ...CFG, poll_interval: 15 },
  });
  await start();
  world.queue.push((r) =>
    /Get=D/.test(r.path) ? { json: { product: 'IPX800_V4', status: 'Success' } } : undefined,
  );
  await wait(15 * SECOND);
  assert.match(message(gladys), /not an Eco-Devices RT2/);
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('w4: an Off kept in /data, an IPX800 at the address after a restart: never sent to it', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  world.R[1] = 1;
  const first = await setup({ world, devices, config: CFG });
  await first.start();
  world.ignoreWrites = true;
  await first.cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(first.store.data.guards.length, 1);
  first.app.stop();
  world.ignoreWrites = false;
  world.product = 'IPX800_V4';
  const before = world.writes().length;
  const second = await setup({
    world,
    devices,
    config: CFG,
    store: first.store,
    clock: first.clock,
  });
  await second.app.connected(CFG);
  await second.wait(5 * SECOND);
  assert.deepEqual(writesTo(world, before), [], 'the kept Off never reached the IPX800');
  assert.equal(world.R[1], 1);
  assert.match(message(second.gladys), /not an Eco-Devices RT2/);
  // The RT2 back: the next round reads it, the Off kept goes.
  world.product = 'EcoDevices_RT';
  await second.wait(6 * 60 * SECOND);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.equal(world.R[1], 0);
  second.app.stop();
});

test('an answer without "product" is never taken for an Eco-Devices RT2', async () => {
  const world = fakeRt2();
  world.product = undefined;
  const { app, start, gladys } = await setup({ world });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys), /its answer has no "product" field \(expected "EcoDevices_RT"\)/);
  assert.match(message(gladys, 'fr'), /pas de champ « product »/);
  app.stop();
});

test('an Off with the reads hanging: its product read given up after 1 s, then it leaves', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, start, act, gladys, clock } = await setup({ world, devices, config: CFG });
  await start();
  world.latency = (r) => (/Get=/.test(r.path) ? 60 * SECOND : 20);
  const t0 = clock.elapsed;
  await act(gladys.fake.setValue(devices[0], devices[0].features[0], 0));
  const write = world.writes().find((w) => /ClearR=01/.test(w.path));
  assert.ok(write, 'the Off left');
  const after = write.sentAt - t0;
  assert.ok(
    after >= TIMINGS.productCheck - 50 && after < TIMINGS.productCheck + 100,
    `${after} ms`,
  );
  assert.equal(world.R[1], 0);
  app.stop();
});

test('an Off right after a read that showed the RT2 (within 250 ms): no read before it', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  world.R[1] = 1;
  world.R[2] = 1;
  const { app, start, act, gladys } = await setup({ world, devices, config: CFG });
  await start();
  world.requests.length = 0;
  // Two clicks together: one product read, two writes.
  await act(
    Promise.all([
      gladys.fake.setValue(devices[0], devices[0].features[0], 0),
      gladys.fake.setValue(devices[1], devices[1].features[0], 0),
    ]),
  );
  const order = world.requests.map((r) => tail(r.path));
  assert.equal(order[0], 'Get=R');
  assert.deepEqual(order.slice(1, 3).sort(), ['ClearR=01', 'ClearR=02']);
  app.stop();
});

test('a command never leaves without a product read after its click (the round long ago)', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, cmd, wait } = await setup({ world, devices, config: CFG });
  await start();
  await wait(60 * SECOND);
  world.requests.length = 0;
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  assert.deepEqual(
    world.requests.slice(0, 2).map((r) => tail(r.path)),
    ['Get=R', 'SetR=02'],
  );
  app.stop();
});

test('a command whose product read does not answer: nothing sent, said', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, cmd, wait } = await setup({ world, devices, config: CFG });
  await start();
  await wait(60 * SECOND);
  world.latency = (r) => (/Get=/.test(r.path) ? 60 * SECOND : 20);
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  assert.equal(on.success, false);
  assert.match(on.error, /rien n’a été envoyé/);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('R12: a lone On 2 s after a round, an IPX800 now at the address: never reaches it', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, cmd, wait } = await setup({ world, devices, config: CFG });
  await start();
  await wait(2 * SECOND);
  world.product = 'IPX800_V4';
  const before = world.writes().length;
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  assert.equal(on.success, false);
  assert.deepEqual(writesTo(world, before), []);
  assert.ok(TIMINGS.productTolerance <= 250);
  app.stop();
});

test('R24: the product read answered 503: the On is refused, nothing sent', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  const { app, start, cmd, wait } = await setup({ world, devices, config: CFG });
  await start();
  await wait(2 * SECOND);
  world.failGroups.set('R', 503);
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  assert.equal(on.success, false);
  assert.match(on.error, /rien n’a été envoyé/);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('m2: write answers without "product" (reads have it): applied and confirmed, no error said', async () => {
  const devices = devicesOf();
  const world = fakeRt2();
  world.R[1] = 1;
  world.noWriteProduct = true;
  const { app, start, cmd, gladys } = await setup({ world, devices, config: CFG });
  await start();
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  const on = await cmd(devices[1], F('relay', 'r2', 'switch'), 1);
  assert.equal(off.success, true, off.error);
  assert.equal(on.success, true, on.error);
  assert.deepEqual([world.R[1], world.R[2]], [0, 1]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
});
