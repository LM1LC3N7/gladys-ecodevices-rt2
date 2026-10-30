// -----------------------------------------------------------------------------
// Which Eco-Devices the devices belong to (the owner in /data: its address
// and port): a device made for one never drives another one, an Off kept for
// the old one neither; Discover shows only the box really read. Taken from
// the address part of gladys-ipx800's tests.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerKey } from '../src/config.js';
import { TIMINGS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, boundMemory, created, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const discovered = (gladys) => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
const switchOf = (code) => created('relay', code, { relayKind: 'switch' });

test('a box moved to another address: refused until "Attach the devices" is clicked twice', async () => {
  const device = switchOf('r1');
  const { app, gladys, store, start, wait, cmd, world } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
  });
  await start();
  const moved = { ...CONFIG, host: '192.168.1.61', relays: 'R1' };
  await gladys.fake.configUpdated(moved);
  await wait(15 * SECOND);
  assert.match(message(gladys), /created for the Eco-Devices at another address/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, false, 'an Off neither');
  const first = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(first.data.message.en, /Click again within a minute to attach the 1 device\(s\)/);
  assert.equal(world.writes().length, 0);
  await wait(TIMINGS.attachConfirm + SECOND);
  const late = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(late.data.message.en, /Click again/, 'a second click after a minute asks again');
  const done = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(done.data.message.fr, /C’est fait : les 1 appareil\(s\) de l’Eco-Devices n°1/);
  assert.equal(store.data.owner.id, controllerKey('192.168.1.61', 80));
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(discovered(gladys).includes('ext:rt2:relay:r1'));
  const again = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(again.data.message.en, /already belong/);
  app.stop();
});

test('the Offs kept for the old address are dropped, never sent to the new one', async () => {
  const device = switchOf('r1');
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, gladys, store, start, wait, cmd } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    world,
  });
  await start();
  world.ignoreWrites = true;
  await cmd(device, F('relay', 'r1', 'switch'), 0);
  assert.equal(store.data.guards.length, 1);
  const writes = world.writes().length;
  await gladys.fake.configUpdated({ ...CONFIG, host: '192.168.1.61', relays: 'R1' });
  await wait(60 * SECOND);
  assert.equal(world.writes().length, writes, 'nothing to the new address');
  assert.equal(store.data.guards.length, 0);
  app.stop();
});

test('Attach: nothing read yet, or the box not answering: refused', async () => {
  const world = fakeRt2();
  world.refuseConnect = 99;
  const { app, start } = await setup({ world, devices: [switchOf('r1')] });
  assert.match((await app.attach()).en, /No Eco-Devices read right now/);
  await start();
  assert.match((await app.attach()).en, /No Eco-Devices read right now/);
  app.stop();
});

test('a slot without devices takes the box read as its owner', async () => {
  const { app, gladys, store, start } = await setup({ fresh: true });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(discovered(gladys).length > 0);
  assert.deepEqual(store.data.owner, boundMemory().owner);
  app.stop();
});

test('/data unreadable: no owner set over it, an Off goes, a switch-on waits for it', async () => {
  const device = switchOf('r1');
  const store = memoryStore();
  store.unreadable = true;
  const config = { ...CONFIG, relays: 'R1' };
  const { app, gladys, start, wait, cmd, world } = await setup({
    config,
    devices: [device],
    store,
    fresh: true,
  });
  await start();
  assert.match(message(gladys), /state in \/data cannot be read/);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, false);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 0)).success, true);
  assert.equal(world.writes().length, 1);
  assert.equal(store.data, null, 'nothing written over it');
  store.unreadable = false;
  store.data = boundMemory(config);
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

test('/data lost (a fresh file) with devices there: not bound to whatever answers, Attach asked', async () => {
  const device = switchOf('r1');
  const { app, gladys, store, start, cmd, world } = await setup({
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
    fresh: true,
  });
  await start();
  assert.equal(store.data.owner, null);
  assert.match(message(gladys), /not known to belong to the Eco-Devices read/);
  for (const value of [0, 1]) {
    assert.equal((await cmd(device, F('relay', 'r1', 'switch'), value)).success, false);
  }
  assert.equal(world.writes().length, 0);
  await gladys.fake.action('attach_devices', { box: '1' });
  await gladys.fake.action('attach_devices', { box: '1' });
  assert.equal((await cmd(device, F('relay', 'r1', 'switch'), 1)).success, true);
  app.stop();
});

test('Discover: only what was read; emptied by a failure, a refused key, no address', async () => {
  const world = fakeRt2();
  world.latency = 2 * SECOND;
  const { app, gladys, start, wait } = await setup({ world });
  const starting = app.connected(CONFIG);
  await wait(500);
  assert.deepEqual(discovered(gladys), [], 'the targets of the configuration: not read yet');
  await starting;
  await start();
  await wait(10 * SECOND);
  assert.ok(discovered(gladys).includes('ext:rt2:relay:r1'));
  world.latency = 20;
  world.refuseConnect = 99;
  await wait(15 * SECOND);
  assert.deepEqual(discovered(gladys), [], 'unreachable');
  await gladys.fake.scanRequest();
  assert.deepEqual(discovered(gladys), []);
  world.refuseConnect = 0;
  await wait(60 * SECOND);
  assert.ok(discovered(gladys).length > 0);
  world.key = 'another';
  await wait(15 * SECOND);
  assert.deepEqual(discovered(gladys), [], 'a refused key');
  await gladys.fake.configUpdated({ ...CONFIG, host: '' });
  assert.deepEqual(discovered(gladys), [], 'no address: the old list goes');
  app.stop();
});

test('a device deleted: the Discover list again at once, without the switch of the deleted one', async () => {
  const device = switchOf('r2');
  const { app, gladys, start } = await setup({
    config: { ...CONFIG, relays: 'R1, R2' },
    devices: [device],
  });
  await start();
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  const before = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:relay:r2');
  assert.deepEqual(
    before.features.map((f) => f.external_id.split(':').pop()),
    ['readonly', 'switch'],
  );
  await gladys.fake.deviceDeleted(gladys.devices.find((d) => d.external_id === device.external_id));
  const after = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:relay:r2');
  assert.deepEqual(
    after.features.map((f) => f.external_id.split(':').pop()),
    ['readonly'],
  );
  app.stop();
});

test('a command waiting in the queue is refused right before it leaves when another box was found', async () => {
  const r1 = switchOf('r1');
  const r2 = switchOf('r2');
  const world = fakeRt2();
  const { app, start, act, gladys } = await setup({
    config: { ...CONFIG, relays: 'R1, R2' },
    devices: [r1, r2],
    world,
  });
  await start();
  world.latency = (r) => (/SetR/.test(r.path) ? 1000 : 20);
  const first = gladys.fake.setValue(r1, { external_id: F('relay', 'r1', 'switch') }, 1);
  const second = gladys.fake.setValue(r2, { external_id: F('relay', 'r2', 'switch') }, 1);
  const flip = (async () => {
    while (world.writes().length === 0) await new Promise((r) => setImmediate(r));
    // A round finds another box while the first write is in flight.
    app.verdict = 'different';
  })();
  const [a, b] = await act(Promise.all([first, second, flip]));
  assert.equal(a.success !== undefined, true);
  assert.match(b.error, /autre adresse/);
  assert.equal(world.writes().length, 1, 'the second never left');
  app.stop();
});
