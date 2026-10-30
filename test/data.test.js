// -----------------------------------------------------------------------------
// /data that never answers or never takes a write (review r1, I2 and I4): the
// Offs of listed relays and zones still go, the rounds go on, the status says
// so, the test button answers; the real file store merges the saves waiting
// behind a write that hangs. Then the slots (m1, m2) and the refused key (m3).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PILOT, TIMINGS } from '../src/constants.js';
import { Rt2Hub } from '../src/hub.js';
import { registerHandlers } from '../src/handlers.js';
import { fileStore, memoryStore } from '../src/store.js';
import { testClock } from './kit/index.mjs';
import { KEY, fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, START, SALT, created, settle, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const CFG = { ...CONFIG, relays: 'R1', extensions: 'FP1', counters: 'C3:electricity:wh' };
const rounds = (world) => world.requests.filter((r) => /Index=all/.test(r.path)).length;

test('I2: /data never writable, no file, devices there: the Offs go, before and after a round', async () => {
  const devices = [
    created('relay', 'r1', { relayKind: 'switch' }),
    created('pilot-wire', 'fp1'),
    created('meter', 'c3', { feature: 'energy-index', id: 'd-c3' }),
  ];
  const store = memoryStore();
  store.fail = true;
  const world = fakeRt2();
  world.R[1] = 1;
  world.FP[1] = 'Confort';
  const { app, gladys, cmd, act, wait } = await setup({
    world,
    devices,
    store,
    config: CFG,
    fresh: true,
  });
  const started = app.connected(CFG);
  await act(started);
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.R[1], 0);
  const on = await cmd(devices[0], F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, false);
  assert.match(on.error, /ni lu ni écrit/);
  await wait(16 * SECOND);
  const zone = await cmd(devices[1], F('pilot-wire', 'fp1', 'mode'), PILOT.OFF);
  assert.equal(zone.success, true, zone.error);
  assert.equal(world.FP[1], 'Arret');
  assert.match(message(gladys), /cannot be written to \/data and holds nothing yet/);
  assert.equal(gladys.fake.lastState(F('meter', 'c3', 'energy-index')), undefined);
  const attach = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(
    attach.data.message.en,
    /cannot be written to \/data/,
    'a relink kept nowhere: refused',
  );
  app.stop();
});

test('I2: /data writable again: the owner stays unknown until "Attach", which then holds', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const store = memoryStore();
  store.fail = true;
  const { app, gladys, start, wait, cmd } = await setup({
    devices,
    store,
    config: CFG,
    fresh: true,
  });
  await start();
  store.fail = false;
  await wait(15 * SECOND);
  await gladys.fake.action('attach_devices', { box: '1' });
  const done = await gladys.fake.action('attach_devices', { box: '1' });
  assert.match(done.data.message.en, /Done/);
  assert.ok(store.data.owner, 'kept in /data: it holds after a restart');
  const on = await cmd(devices[0], F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  app.stop();
});

test('I4: a /data write that never ends: the rounds go on, the status says so, no index, test answers', async () => {
  const devices = [created('meter', 'c3', { feature: 'energy-index', id: 'd-c3' })];
  const store = memoryStore();
  const { app, gladys, start, wait, act, world } = await setup({
    devices,
    store,
    config: { ...CFG, poll_interval: 5 },
  });
  await start();
  const published = gladys.fake.states.length;
  store.save = () => new Promise(() => {});
  const before = rounds(world);
  await wait(20 * SECOND);
  assert.ok(rounds(world) - before >= 2, `${rounds(world) - before} rounds in 20 s`);
  assert.match(message(gladys), /cannot be written to \/data/);
  world.C[3] += 1000;
  await wait(10 * SECOND);
  assert.equal(gladys.fake.states.length, published, 'no index without /data');
  // A round ends (bounded by the /data waits): the button then answers with the status.
  for (let i = 0; i < 100 && app.running; i += 1) await wait(100);
  assert.equal(app.running, undefined, 'no round hanging');
  const answer = await act(gladys.fake.action('test_connection', {}));
  assert.doesNotMatch(answer.data.message.en, /already running/);
  assert.match(answer.data.message.en, /\/data/);
  app.stop();
});

test('I4: a /data read that never ends at start: taken as unreadable, the Off still goes', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const store = memoryStore();
  store.load = () => new Promise(() => {});
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, gladys, act, cmd } = await setup({ world, devices, store, config: CFG });
  await act(app.connected(CFG));
  assert.match(message(gladys), /cannot be read/);
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.ok(TIMINGS.storeWait <= 2 * SECOND);
  app.stop();
});

test('the file store: saves waiting behind a write merged into one, the last state written', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rt2-merge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = fileStore(join(dir, 'state.json'));
  const all = [];
  for (let i = 0; i < 30; i += 1)
    all.push(
      store.save({ i }).then(
        () => 'ok',
        (e) => e.code,
      ),
    );
  const results = await Promise.all(all);
  assert.deepEqual(await store.load(), { i: 29 });
  assert.ok(results.filter((r) => r === 'EBUSY').length > 0, 'the oldest waiters are told');
  assert.equal(results.at(-1), 'ok');
});

// --- The slots ---------------------------------------------------------------------

async function hub(config) {
  const clock = testClock({ start: START });
  const world = fakeRt2();
  world.clock = clock;
  const gladys = createFakeGladys({ selector: 'rt2', config });
  await gladys.connect();
  const quiet = () => {};
  const app = new Rt2Hub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    transport: world.transport,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: () => memoryStore(),
    random: () => SALT,
  });
  registerHandlers(gladys, app);
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle();
  };
  return { app, gladys, world, wait };
}

test('m1: the same address in two slots: the second is not read, said', async () => {
  const { app, gladys, world, wait } = await hub({
    host: CONFIG.host,
    api_key: KEY,
    host_2: `${CONFIG.host}:80`,
    api_key_2: KEY,
  });
  await app.onConnected(() => gladys.getConfig());
  await wait(2000);
  assert.match(message(gladys), /Eco-Devices #2: Same address as Eco-Devices #1/);
  assert.equal(world.peak, 1);
  assert.ok(!gladys.fake.discoveredDevices.some((d) => /rt22:/.test(d.external_id)));
  app.stop();
});

test('m2: an id of a slot this version does not have: a plain refusal, nothing thrown', async () => {
  const { app, gladys, wait } = await hub({ host: CONFIG.host, api_key: KEY });
  await app.onConnected(() => gladys.getConfig());
  await wait(2000);
  const ack = await gladys.fake.setValue(
    { external_id: 'ext:rt2:rt27:relay:r1' },
    { external_id: 'ext:rt2:rt27:relay:r1:switch' },
    0,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /n’est pas connue|not known/);
  await gladys.fake.deviceDeleted({ external_id: 'ext:rt2:rt24:relay:r1' });
  await gladys.fake.deviceCreated({ external_id: 'ext:rt2:rt24:relay:r1', features: [] });
  app.stop();
});

test('m3: an Off while the key is refused: the ack says it is kept, and it goes with the new key', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, gladys, start, wait, cmd } = await setup({ world, devices, config: CFG });
  await start();
  world.key = 'new-key';
  await wait(15 * SECOND);
  assert.match(message(gladys), /refused the API key/);
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.match(off.error, /l’arrêt est gardé, et renvoyé dès qu’une nouvelle clé/);
  assert.doesNotMatch(off.error, /rien n’a été envoyé/);
  await app.configUpdated({ ...CFG, api_key: 'new-key' });
  await wait(2000);
  assert.equal(world.R[1], 0);
  app.stop();
});
