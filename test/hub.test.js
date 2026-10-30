// -----------------------------------------------------------------------------
// Several Eco-Devices RT2 in one integration (src/hub.js): each slot its own
// ids, devices, lane and /data; one status, one Discover list, one
// publisher. Virtual clock with fakes behind one transport (dispatched by
// address), then a real clock (x20) against two real local HTTP fakes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Rt2Hub } from '../src/hub.js';
import { registerHandlers } from '../src/handlers.js';
import { parseExternalId, slotOf } from '../src/devices.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn, testClock } from './kit/index.mjs';
import { KEY, fakeRt2 } from './helpers/fakeRt2.js';
import { httpRt2 } from './helpers/httpRt2.js';
import { START, SALT, settle } from './helpers/app.js';

const HOST_1 = '192.168.1.60';
const HOST_2 = '192.168.1.61';
const CONFIG = {
  host: HOST_1,
  api_key: KEY,
  relays: 'R1',
  host_2: HOST_2,
  api_key_2: KEY,
  relays_2: 'R1, R2',
};

async function hubSetup({ config = CONFIG, devices = [] } = {}) {
  const clock = testClock({ start: START });
  const w1 = fakeRt2();
  const w2 = fakeRt2();
  w1.clock = clock;
  w2.clock = clock;
  w2.TI[1] = 99_000_000;
  const gladys = createFakeGladys({ selector: 'rt2', config, devices });
  await gladys.connect();
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const stores = new Map([1, 2, 3].map((s) => [s, memoryStore()]));
  const hub = new Rt2Hub({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    transport: (o, h) => (o.hostname === HOST_2 ? w2 : w1).transport(o, h),
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: (slot) => stores.get(slot),
    random: () => SALT,
  });
  registerHandlers(gladys, hub);
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle();
  };
  const act = async (promise) => {
    let done = false;
    const out = promise.then(
      (v) => ((done = true), v),
      (e) => ((done = true), { error: e }),
    );
    for (let t = 0; !done && t < 30_000; t += 10) {
      await clock.advance(10);
      await settle(3);
    }
    return out;
  };
  const start = async () => {
    await act(hub.onConnected(() => gladys.getConfig()));
    await wait(1000);
  };
  const ids = () => (gladys.fake.discoveredDevices ?? []).map((d) => d.external_id);
  const create = async (id) => {
    const d = gladys.fake.discoveredDevices.find((x) => x.external_id === `ext:rt2:${id}`);
    await gladys.fake.deviceCreated(d);
    return d;
  };
  return { clock, w1, w2, gladys, hub, wait, act, start, ids, create, stores, lines };
}

test('two Eco-Devices: their own ids, Discover put together, one status line each', async () => {
  const { gladys, hub, start, ids } = await hubSetup();
  await start();
  assert.ok(ids().includes('ext:rt2:relay:r1'));
  assert.ok(ids().includes('ext:rt2:rt22:relay:r1'));
  assert.ok(ids().includes('ext:rt2:rt22:meter:ti1'));
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.ok(names.includes('Eco-Devices n°2 · Relais 1 (R1)'), names.join(' | '));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Eco-Devices #1: Connected.*\nEco-Devices #2: Connected/s,
  );
  assert.equal(slotOf('ext:rt2:rt22:relay:r1', 'rt2'), 2);
  assert.equal(slotOf('ext:rt2:relay:r1', 'rt2'), 1);
  assert.deepEqual(parseExternalId('ext:rt2:rt22:relay:r1:switch', 'rt2', 2), {
    kind: 'relay',
    code: 'r1',
    key: 'switch',
  });
  assert.equal(parseExternalId('ext:rt2:rt22:relay:r1:switch', 'rt2', 1), undefined);
  hub.stop();
});

test('each command to its own box; an index to its own device', async () => {
  const { w1, w2, gladys, hub, start, create, wait, act } = await hubSetup();
  await start();
  const r1 = await create('relay:r1');
  const r2 = await create('rt22:relay:r2');
  const ti = await create('rt22:meter:ti1');
  await wait(15_000);
  const on1 = await act(gladys.fake.setValue(r1, r1.features[0], 1));
  assert.equal(on1.success, true, on1.error);
  const on2 = await act(gladys.fake.setValue(r2, r2.features[0], 1));
  assert.equal(on2.success, true, on2.error);
  assert.deepEqual(
    w1.writes().map((r) => r.path.split('&').pop()),
    ['SetR=01'],
  );
  assert.deepEqual(
    w2.writes().map((r) => r.path.split('&').pop()),
    ['SetR=02'],
  );
  assert.equal(gladys.fake.lastState(ti.features[0].external_id), 99000);
  hub.stop();
});

test('the test button and Accept answer for each box; Attach goes to the slot chosen', async () => {
  const { gladys, start, wait, hub } = await hubSetup();
  await start();
  await wait(10_000);
  const answer = await gladys.fake.action('test_connection', {});
  assert.match(answer.data.message.en, /Eco-Devices #1: .*\nEco-Devices #2: /s);
  const accept = await gladys.fake.action('accept_held_index', {});
  assert.match(accept.data.message.en, /Eco-Devices #1: No index.*\nEco-Devices #2: No index/s);
  const attach = await gladys.fake.action('attach_devices', { box: '2' });
  assert.match(attach.data.message.en, /devices of Eco-Devices #2 already belong/);
  const none = await gladys.fake.action('attach_devices', { box: '7' });
  assert.match(none.data.message.en, /Choose an Eco-Devices/);
  hub.stop();
});

test('a slot whose box moved to another address: its devices get nothing until attached twice', async () => {
  const { gladys, hub, start, create, wait, w2, act } = await hubSetup();
  await start();
  const relay = await create('rt22:relay:r1');
  await wait(15_000);
  await act(hub.configUpdated({ ...CONFIG, host_2: '192.168.1.61:8080' }));
  await wait(16_000);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /created for the Eco-Devices at another address/,
  );
  const ack = await act(gladys.fake.setValue(relay, relay.features[0], 1));
  assert.equal(ack.success, false);
  assert.equal(w2.writes().length, 0);
  const first = await gladys.fake.action('attach_devices', { box: '2' });
  assert.match(first.data.message.en, /Click again within a minute/);
  const second = await gladys.fake.action('attach_devices', { box: '2' });
  assert.match(second.data.message.en, /Done: the 1 device\(s\) of Eco-Devices #2/);
  const again = await act(gladys.fake.setValue(relay, relay.features[0], 1));
  assert.equal(again.success, true, again.error);
  hub.stop();
});

test('real clock x20: two boxes over HTTP, each read at the interval, each command to its own', async (t) => {
  const one = await httpRt2({ key: 'k1' });
  const two = await httpRt2({ key: 'k2' });
  const clock = realClock({ speed: 20 });
  t.after(async () => {
    clock.close();
    await one.srv.close();
    await two.srv.close();
  });
  const gladys = createFakeGladys({ selector: 'rt2', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const hub = new Rt2Hub({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    storeOf: () => memoryStore(),
  });
  registerHandlers(gladys, hub);
  t.after(() => hub.stop());
  const spy = spyOn(hub.controllers.get(2), 'readRound', clock);
  const config = {
    host: one.address,
    api_key: 'k1',
    relays: 'R1',
    host_2: two.address,
    api_key_2: 'k2',
    relays_2: 'R2',
  };
  gladys.fake.config = config;
  await hub.onConnected(async () => config);
  const gaps = await measurePeriod(spy, { count: 3, period: POLL_INTERVAL.default * 1000 });
  assert.equal(gaps.length, 2);
  const ack = await gladys.fake.setValue(
    { external_id: 'ext:rt2:rt22:relay:r2' },
    { external_id: 'ext:rt2:rt22:relay:r2:switch' },
    1,
  );
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(two.writes(), ['SetR=02']);
  assert.deepEqual(one.writes(), []);
  hub.stop();
});
