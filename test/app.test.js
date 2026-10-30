// -----------------------------------------------------------------------------
// End to end: the app against the SDK's fake Gladys, a fake Eco-Devices RT2
// and a virtual clock whose reads always move. Reads, Discover, relays read
// only by default, commands and their confirmation, the heating option.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILOT, TIMINGS } from '../src/constants.js';
import { KEY, fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const rounds = (world) => world.requests.filter((r) => /Get=R$/.test(r.path));
const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const withRelays = (relays = 'R1, R2:light', more = {}) => ({ ...CONFIG, relays, ...more });

// --- Reads ----------------------------------------------------------------------

test('start: one round at once (relays, inputs, indexes), connected, Discover; nothing secret in /data', async () => {
  const { app, gladys, start, store, world } = await setup({
    config: { ...CONFIG, extensions: 'FP1-FP4, THL1' },
  });
  await start();
  assert.equal(rounds(world).length, 1);
  assert.deepEqual(
    world.requests.map((r) => new URL(r.path, 'http://x').search.replace(`?key=${KEY}&`, '')),
    ['Get=R', 'Get=D', 'Get=FP', 'Get=XTHL', 'Index=all'],
  );
  assert.equal(world.peak, 1, 'one request at a time');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    message(gladys),
    /Eco-Devices RT2: 10 relay\(s\), 12 input\(s\), 4 pilot-wire zone\(s\), 1 X-THL, 3 index\(es\)/,
  );
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes('ext:rt2:relay:r10'));
  assert.ok(ids.includes('ext:rt2:input:d12'));
  assert.ok(ids.includes('ext:rt2:pilot-wire:fp4'));
  assert.ok(!ids.includes('ext:rt2:pilot-wire:fp5'), 'only the zones listed');
  assert.ok(ids.includes('ext:rt2:thl:thl1'));
  assert.ok(ids.includes('ext:rt2:meter:ti1') && ids.includes('ext:rt2:meter:ti2'));
  assert.ok(ids.includes('ext:rt2:meter:tore1'));
  assert.ok(!ids.includes('ext:rt2:meter:ti3'), 'an index at 0 is not a meter');
  assert.ok(!ids.includes('ext:rt2:meter:c1'), 'a counter only once configured');
  const relay = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:relay:r1');
  assert.equal(relay.features.length, 1);
  assert.equal(relay.features[0].external_id, F('relay', 'r1', 'readonly'));
  assert.equal(relay.features[0].read_only, true, 'a relay not declared is read only');
  const ti = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:meter:ti1');
  assert.equal(ti.features[0].category, 'energy-sensor');
  assert.equal(ti.features[0].type, 'index');
  assert.equal(ti.features[0].unit, 'kilowatt-hour');
  const json = JSON.stringify(store.data);
  assert.doesNotMatch(json, new RegExp(KEY));
  assert.doesNotMatch(json, /192\.168/);
  assert.equal(gladys.fake.states.length, 0, 'no state before a device is created');
  app.stop();
});

test('values of created devices published; a text or an absent key never as 0', async () => {
  const devices = [
    created('relay', 'r1'),
    created('input', 'd2'),
    created('pilot-wire', 'fp1'),
    created('thl', 'thl1'),
  ];
  const world = fakeRt2();
  world.R[1] = 1;
  world.D[2] = 1;
  world.FP[1] = 'Hors Gel';
  world.THL[1] = { TEMP: 19.5, HUM: '--', LUM: 120 };
  const { app, gladys, start } = await setup({
    devices,
    world,
    config: { ...CONFIG, extensions: 'FP1, THL1' },
  });
  await start();
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), 1);
  assert.equal(gladys.fake.lastState(F('input', 'd2', 'state')), 1);
  assert.equal(gladys.fake.lastState(F('pilot-wire', 'fp1', 'mode')), PILOT.FROST_PROTECTION);
  assert.equal(gladys.fake.lastState(F('thl', 'thl1', 'temperature')), 19.5);
  assert.equal(gladys.fake.lastState(F('thl', 'thl1', 'humidity')), undefined, 'a text is no 0');
  assert.equal(gladys.fake.lastState(F('thl', 'thl1', 'luminosity')), 120);
  app.stop();
});

test('the pace: one round per interval, never sooner (Discover, test button, reconnection)', async () => {
  const { app, gladys, start, wait, world, act } = await setup();
  await start();
  assert.equal(rounds(world).length, 1);
  await act(app.scan());
  await act(app.testConnection());
  await act(app.connected(CONFIG));
  assert.equal(rounds(world).length, 1, 'nothing reads sooner than the interval');
  await wait(15 * SECOND);
  assert.equal(rounds(world).length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
});

test('a restart reads no sooner than the interval (the attempt kept in /data)', async () => {
  const first = await setup();
  await first.start();
  await first.app.shutdown();
  const second = await setup({ store: first.store, clock: first.clock });
  await second.app.connected(CONFIG);
  await second.wait(2 * SECOND);
  assert.equal(rounds(second.world).length, 0);
  await second.wait(14 * SECOND);
  assert.equal(rounds(second.world).length, 1);
  second.app.stop();
});

test('a secondary group failing (FP 500, Index=all 404) never stops the round nor publishes 0', async () => {
  const world = fakeRt2();
  world.failGroups.set('FP', 500);
  world.failGroups.set('all', 404);
  const devices = [created('pilot-wire', 'fp1'), created('relay', 'r1')];
  const { app, gladys, start } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1' },
  });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys), /Not read this time .*pilot-wire zones, indexes/);
  assert.match(message(gladys, 'fr'), /Non lus cette fois .*zones de fil pilote, index/);
  assert.equal(gladys.fake.lastState(F('pilot-wire', 'fp1', 'mode')), undefined);
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), 0);
  app.stop();
});

test('the relays not read: the round fails, a pause, Discover emptied, the reason said', async () => {
  const world = fakeRt2();
  const { app, gladys, start, wait } = await setup({ world });
  await start();
  assert.ok(gladys.fake.discoveredDevices.length > 0);
  world.failReads = 503;
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys), /does not answer \(the Eco-Devices asks to wait \(HTTP 503\)\)/);
  assert.deepEqual(gladys.fake.discoveredDevices, [], 'an unreachable box leaves Discover');
  app.stop();
});

test('another GCE product at the address (an IPX800 V4): nothing read, nothing sent, said', async () => {
  const world = fakeRt2();
  world.product = 'IPX800_V4';
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const { app, gladys, start, cmd } = await setup({ world, devices, config: withRelays('R1') });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys), /not an Eco-Devices RT2 \(it answers as "IPX800_V4"\)/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  const ack = await cmd(devices[0], F('relay', 'r1', 'switch'), 1);
  assert.equal(ack.success, false);
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('a refused key stops the reads until it changes; never in a status or a log', async () => {
  const world = fakeRt2({ key: 'the-right-one' });
  const { app, gladys, start, wait, lines } = await setup({ world });
  await start();
  assert.match(message(gladys), /refused the API key/);
  const before = world.requests.length;
  await wait(60 * SECOND);
  assert.equal(world.requests.length, before, 'no read while the key is refused');
  await app.configUpdated({ ...CONFIG, api_key: 'the-right-one' });
  await wait(1000);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.doesNotMatch(lines.join('\n'), /the-right-one|S3cret/);
  assert.doesNotMatch(JSON.stringify(gladys.fake.connectionStatuses), /the-right-one|S3cret/);
  app.stop();
});

test('no API key (the protection off): no key in the query', async () => {
  const world = fakeRt2({ key: '' });
  const { app, gladys, start } = await setup({ world, config: { host: CONFIG.host } });
  await start();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(world.requests.every((r) => !/key=/.test(r.path)));
  app.stop();
});

test('getConfig failing in connected: tried again without end, the status says so, then starts', async () => {
  let fail = 2;
  const getConfig = async () => {
    if (fail > 0) {
      fail -= 1;
      throw new Error('gladys busy');
    }
    return CONFIG;
  };
  const { app, gladys, wait, world } = await setup({ getConfig });
  await app.onConnected(() => gladys.getConfig());
  await wait(100);
  assert.match(message(gladys), /could not be read from Gladys: new try in 5 s/);
  assert.equal(world.requests.length, 0);
  await wait(5 * SECOND);
  assert.match(message(gladys), /new try in 15 s/);
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
});

test('a relay not listed is read only: its command refused, nothing sent', async () => {
  const devices = [created('relay', 'r3')];
  const { app, start, cmd, world } = await setup({ devices });
  await start();
  const ack = await cmd(devices[0], F('relay', 'r3', 'readonly'), 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /lecture seule/);
  const forged = await cmd(devices[0], F('relay', 'r3', 'switch'), 0);
  assert.equal(forged.success, false, 'a forged switch of a relay not listed');
  assert.equal(world.writes().length, 0);
  app.stop();
});

test('the status says the relays are read only while none is listed', async () => {
  const { app, gladys, start } = await setup();
  await start();
  assert.match(
    message(gladys),
    /10 relays read only: list in Configuration → Relays Gladys may drive/,
  );
  assert.match(message(gladys), /never a pump/);
  app.stop();
});

test('a listed relay: on and off, confirmed by a read back; a switch in Discover', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const { app, gladys, start, cmd, world } = await setup({ devices, config: withRelays('R1') });
  await start();
  const relay = gladys.fake.discoveredDevices.find((d) => d.external_id === 'ext:rt2:relay:r1');
  assert.equal(relay.features[0].external_id, F('relay', 'r1', 'switch'));
  assert.equal(relay.features[0].read_only, false);
  const on = await cmd(devices[0], F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, true, on.error);
  assert.equal(world.R[1], 1);
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.R[1], 0);
  assert.deepEqual(
    world.writes().map((r) => r.path.split('&').pop()),
    ['SetR=01', 'ClearR=01'],
  );
  app.stop();
});

test('a write the box does not apply: "not applied yet", never success', async () => {
  const world = fakeRt2();
  world.ignoreWrites = true;
  const devices = [created('relay', 'r2', { relayKind: 'switch' })];
  const { app, start, cmd } = await setup({ world, devices, config: withRelays('R2') });
  await start();
  const ack = await cmd(devices[0], F('relay', 'r2', 'switch'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas encore appliquée/);
  app.stop();
});

test('a command without answer: "sent, without confirmation", never success nor "not sent"', async () => {
  const world = fakeRt2();
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const { app, start, cmd } = await setup({ world, devices, config: withRelays('R1') });
  await start();
  world.latency = (r) => (/SetR/.test(r.path) ? 10_000 : 20);
  const ack = await cmd(devices[0], F('relay', 'r1', 'switch'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Envoyée, sans confirmation/);
  app.stop();
});

test('heating modes refused while the option is off; Off and Frost protection always go', async () => {
  const devices = [created('pilot-wire', 'fp2')];
  const { app, start, cmd, world } = await setup({
    devices,
    config: { ...CONFIG, extensions: 'FP1-FP4' },
  });
  await start();
  const comfort = await cmd(devices[0], F('pilot-wire', 'fp2', 'mode'), PILOT.COMFORT);
  assert.equal(comfort.success, false);
  assert.match(comfort.error, /désactivés/);
  assert.equal(world.writes().length, 0);
  const frost = await cmd(devices[0], F('pilot-wire', 'fp2', 'mode'), PILOT.FROST_PROTECTION);
  assert.equal(frost.success, true, frost.error);
  assert.equal(world.FP[2], 'Hors Gel');
  const off = await cmd(devices[0], F('pilot-wire', 'fp2', 'mode'), PILOT.OFF);
  assert.equal(off.success, true, off.error);
  assert.deepEqual(
    world.writes().map((r) => r.path.split('&').pop()),
    ['SetFP02=2', 'SetFP02=3'],
  );
  app.stop();
});

test('heating modes allowed: Comfort written; /data unwritable refuses it, Off still goes', async () => {
  const devices = [created('pilot-wire', 'fp5')];
  const { app, start, cmd, world, store } = await setup({
    devices,
    config: { ...CONFIG, extensions: 'FP5', allow_heating_modes: true },
  });
  await start();
  const comfort = await cmd(devices[0], F('pilot-wire', 'fp5', 'mode'), PILOT.COMFORT);
  assert.equal(comfort.success, true, comfort.error);
  assert.equal(world.FP[5], 'Confort');
  store.fail = true;
  const eco = await cmd(devices[0], F('pilot-wire', 'fp5', 'mode'), PILOT.ECO);
  assert.equal(eco.success, false);
  assert.match(eco.error, /n’a pas pu être écrit dans \/data/);
  assert.equal(world.FP[5], 'Confort');
  const off = await cmd(devices[0], F('pilot-wire', 'fp5', 'mode'), PILOT.OFF);
  assert.equal(off.success, true, off.error);
  assert.equal(world.FP[5], 'Arret');
  app.stop();
});

test('a zone not listed in Extensions is unknown: nothing sent; zone 00 is never written', async () => {
  const devices = [created('pilot-wire', 'fp3')];
  const { app, start, cmd, world } = await setup({
    devices,
    config: { ...CONFIG, extensions: 'FP1' },
  });
  await start();
  const off = await cmd(devices[0], F('pilot-wire', 'fp3', 'mode'), PILOT.OFF);
  assert.equal(off.success, false);
  assert.equal(world.writes().length, 0);
  assert.ok(world.requests.every((r) => !/SetFP00/.test(r.path)));
  app.stop();
});

test('a scene on 5 slow relays (700 ms a request): all 5 written, each acked within 5 s', async () => {
  const devices = [1, 2, 3, 4, 5].map((n) => created('relay', `r${n}`, { relayKind: 'switch' }));
  const world = fakeRt2();
  const { app, start, act, gladys, clock } = await setup({
    world,
    devices,
    config: withRelays('R1, R2, R3, R4, R5'),
  });
  await start();
  world.latency = 700;
  const t0 = clock.elapsed;
  const acks = await act(
    Promise.all(
      devices.map((d, i) =>
        gladys.fake.setValue(d, d.features[0], 1).then((ack) => ({ ack, i, at: clock.elapsed })),
      ),
    ),
  );
  for (const { at } of acks) assert.ok(at - t0 < 5000, `ack after ${at - t0} ms`);
  assert.deepEqual(world.R.slice(1, 6), [1, 1, 1, 1, 1]);
  app.stop();
});

test('a protective Off goes during a pause, with a refused key and with the option off', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' }), created('pilot-wire', 'fp1')];
  const world = fakeRt2();
  world.R[1] = 1;
  world.FP[1] = 'Confort';
  const { app, start, cmd, wait, gladys } = await setup({
    world,
    devices,
    config: withRelays('R1', { extensions: 'FP1' }),
  });
  await start();
  world.failReads = 503;
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const on = await cmd(devices[0], F('relay', 'r1', 'switch'), 1);
  assert.equal(on.success, false, 'a switch-on waits for the pause');
  world.failReads = undefined;
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(world.R[1], 0);
  const zone = await cmd(devices[1], F('pilot-wire', 'fp1', 'mode'), PILOT.OFF);
  assert.equal(zone.success, true, zone.error);
  assert.equal(world.FP[1], 'Arret');
  // The key refused by the box: the reads stop, an Off still leaves.
  world.key = 'another';
  await wait(75 * SECOND);
  assert.match(message(gladys), /refused the API key/);
  const before = world.writes().length;
  const again = await cmd(devices[1], F('pilot-wire', 'fp1', 'mode'), PILOT.FROST_PROTECTION);
  assert.equal(again.success, false);
  assert.equal(world.writes().length, before + 1, 'the Frost protection left');
  app.stop();
});

test('a protective Off cuts a read stuck in flight; the read is no failure', async () => {
  const devices = [created('pilot-wire', 'fp1')];
  const world = fakeRt2();
  world.FP[1] = 'Confort';
  const { app, start, wait, cmd, gladys } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1' },
  });
  await start();
  world.latency = (r) => (/Get=D/.test(r.path) ? 60_000 : 20);
  await wait(15 * SECOND + 100);
  const off = await cmd(devices[0], F('pilot-wire', 'fp1', 'mode'), PILOT.OFF);
  assert.equal(off.success, true, off.error);
  assert.equal(world.FP[1], 'Arret');
  assert.ok(off.success && world.peak === 1);
  world.latency = 20;
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
});

test('an Off clicked before the configuration is read is kept and sent when it comes', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const devices = [created('pilot-wire', 'fp1')];
  const world = fakeRt2();
  world.FP[1] = 'Confort';
  const config = { ...CONFIG, extensions: 'FP1' };
  const { app, gladys, act, wait } = await setup({
    world,
    devices,
    config,
    getConfig: async () => {
      await gate;
      return config;
    },
  });
  const loading = app.onConnected(() => gladys.getConfig());
  const ack = await act(
    gladys.fake.setValue(devices[0], devices[0].features[0], PILOT.OFF),
    10_000,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /gardée et envoyée dès sa lecture/);
  release();
  await loading;
  await wait(2000);
  assert.equal(world.FP[1], 'Arret');
  assert.ok(world.writes()[0].at < world.reads()[0].at, 'the Off before the first read');
  app.stop();
});

test('an Off not answered is kept in /data and sent again after a restart, before any read', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const world = fakeRt2();
  world.R[1] = 1;
  const first = await setup({ world, devices, config: withRelays('R1') });
  await first.start();
  world.latency = (r) => (/ClearR/.test(r.path) ? 10_000 : 20);
  world.ignoreWrites = true;
  const off = await first.cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.equal(first.store.data.guards.length, 1);
  first.app.stop();
  world.latency = 20;
  world.ignoreWrites = false;
  const second = await setup({
    world,
    devices,
    config: withRelays('R1'),
    store: first.store,
    clock: first.clock,
  });
  world.requests.length = 0;
  await second.app.connected(withRelays('R1'));
  await second.wait(100);
  assert.match(world.requests[0].path, /ClearR=01$/);
  assert.equal(world.R[1], 0);
  second.app.stop();
});

test('a guard is sent again when a read contradicts it (3 times at most), then said', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, start, cmd, wait, gladys } = await setup({
    world,
    devices,
    config: withRelays('R1'),
  });
  await start();
  world.ignoreWrites = true;
  const off = await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  for (let i = 0; i < 6; i += 1) await wait(15 * SECOND);
  const clears = world.writes().filter((r) => /ClearR=01/.test(r.path)).length;
  assert.equal(clears, 1 + TIMINGS.resendMax);
  assert.match(message(gladys), /not applied after 3 tries, check on site: R1/);
  app.stop();
});

test('a relay removed from the list is never driven again, its guard dropped', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const world = fakeRt2();
  world.R[1] = 1;
  const { app, start, cmd, wait, store } = await setup({
    world,
    devices,
    config: withRelays('R1'),
  });
  await start();
  world.ignoreWrites = true;
  await cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(store.data.guards.length, 1);
  await app.configUpdated(withRelays(''));
  await wait(100);
  assert.equal(store.data.guards.length, 0);
  const writes = world.writes().length;
  await wait(60 * SECOND);
  assert.equal(world.writes().length, writes);
  app.stop();
});

test('/data never holds the key nor the address; a 64 KB answer is refused', async () => {
  const world = fakeRt2();
  world.queue.push({ json: { status: 'Success', pad: 'x'.repeat(70_000) } });
  const { app, gladys, start, store } = await setup({ world });
  await start();
  assert.match(message(gladys), /answer too large/);
  assert.doesNotMatch(JSON.stringify(store.data), /S3cret|192\.168/);
  app.stop();
});

test('Discover publishes nothing stale: a reconnection resends the status and the list, no state', async () => {
  const devices = [created('relay', 'r1')];
  const { app, gladys, start, act } = await setup({ devices });
  await start();
  const states = gladys.fake.states.length;
  await act(app.connected(CONFIG));
  assert.equal(gladys.fake.states.length, states, 'no old value republished as new');
  app.stop();
});

test('nothing asked before an Off leaves after it; a full queue never refuses an Off', async () => {
  const devices = [1, 2, 3, 4].map((n) => created('pilot-wire', `fp${n}`));
  const world = fakeRt2();
  const { app, start, act, gladys } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1-FP4', allow_heating_modes: true },
  });
  await start();
  world.latency = 400;
  const mode = (d, value) => gladys.fake.setValue(d, d.features[0], value);
  // Comfort on FP1..FP4 (a scene), then an Off on FP4 while they wait.
  const comforts = devices.map((d) => mode(d, PILOT.COMFORT));
  const off = mode(devices[3], PILOT.OFF);
  const acks = await act(Promise.all([...comforts, off]));
  assert.equal(acks[4].success, true, acks[4].error);
  assert.equal(acks[3].success, false, 'the Comfort of FP4 was cancelled by the Off');
  assert.match(acks[3].error, /Annulée par un Arrêt|interrompue|Interrompue/i);
  const fp4 = world.writes().filter((r) => /SetFP04/.test(r.path));
  assert.deepEqual(
    fp4.map((r) => r.path.split('&').pop()),
    ['SetFP04=3'],
    'no Comfort on FP4 after its Off',
  );
  assert.equal(world.FP[4], 'Arret');
  // A full queue of Comfort (16 waiting): an Off still goes.
  world.latency = 300;
  const many = [];
  for (let i = 0; i < 20; i += 1) many.push(mode(devices[i % 3], PILOT.COMFORT));
  const lastOff = mode(devices[0], PILOT.OFF);
  const all = await act(Promise.all([...many, lastOff]));
  assert.ok(all.slice(0, 20).some((a) => /Trop de commandes/.test(a.error ?? '')));
  assert.equal(all[20].success, true, all[20].error);
  assert.equal(world.FP[1], 'Arret');
  app.stop();
});

test('another product seen at the address: no Off to it, even after a restart, until an RT2 answers', async () => {
  const devices = [created('relay', 'r1', { relayKind: 'switch' })];
  const world = fakeRt2();
  world.R[1] = 1;
  const first = await setup({ world, devices, config: withRelays('R1') });
  await first.start();
  world.ignoreWrites = true;
  await first.cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(first.store.data.guards.length, 1, 'an Off kept');
  world.ignoreWrites = false;
  world.product = 'IPX800_V4';
  await first.wait(15 * SECOND);
  assert.match(message(first.gladys), /not an Eco-Devices RT2/);
  const before = world.writes().length;
  const off = await first.cmd(devices[0], F('relay', 'r1', 'switch'), 0);
  assert.equal(off.success, false);
  assert.match(off.error, /pas un Eco-Devices RT2/);
  world.failReads = 503;
  await first.wait(60 * SECOND);
  first.app.stop();
  const second = await setup({
    world,
    devices,
    config: withRelays('R1'),
    store: first.store,
    clock: first.clock,
  });
  await second.app.connected(withRelays('R1'));
  await second.wait(2000);
  assert.equal(world.writes().length, before, 'nothing went to the other product');
  world.failReads = undefined;
  world.product = 'EcoDevices_RT';
  await second.wait(5 * 60 * SECOND);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.equal(world.R[1], 0, 'the Off kept goes once an RT2 answers again');
  second.app.stop();
});

test('a zone removed from Extensions: its kept Off dropped, never sent again', async () => {
  const devices = [created('pilot-wire', 'fp2')];
  const world = fakeRt2();
  world.FP[2] = 'Confort';
  const { app, start, cmd, wait, store } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1-FP2' },
  });
  await start();
  world.ignoreWrites = true;
  await cmd(devices[0], F('pilot-wire', 'fp2', 'mode'), PILOT.OFF);
  assert.equal(store.data.guards.length, 1);
  await app.configUpdated({ ...CONFIG, extensions: 'FP1' });
  await wait(100);
  assert.equal(store.data.guards.length, 0);
  const writes = world.writes().length;
  await wait(60 * SECOND);
  assert.equal(world.writes().length, writes);
  app.stop();
});
