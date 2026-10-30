// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout), sped
// up 20 times, against a real local HTTP server playing an Eco-Devices RT2: the
// rounds start at the interval, never sooner, never a cycle late; a command
// still reads back and resolves. The real clock moves between any two reads.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Rt2App } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/index.mjs';
import { boundMemory, created } from './helpers/app.js';
import { httpRt2 } from './helpers/httpRt2.js';

const SPEED = 20;
const INTERVAL = POLL_INTERVAL.default * 1000;

test('real clock x20: one round per interval (measured), a command confirmed, an index published', async (t) => {
  const rt2 = await httpRt2({ key: 'k', latencyMs: 5 });
  const clock = realClock({ speed: SPEED });
  // Registered first, run last (t.after runs in reverse order).
  t.after(async () => {
    clock.close();
    await rt2.srv.close();
  });
  const devices = [created('meter', 'ti1', { feature: 'energy-index', id: 'd-ti1' })];
  const gladys = createFakeGladys({ selector: 'rt2', config: {}, devices });
  const config = { host: rt2.address, api_key: 'k', relays: 'R1' };
  // The devices belong to this box (an installation that read it before).
  const bound = memoryStore(boundMemory(config));
  await gladys.connect();
  const quiet = () => {};
  const app = new Rt2App({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: bound,
  });
  registerHandlers(gladys, app);
  t.after(() => app.stop());
  const spy = spyOn(app, 'readRound', clock);
  await app.connected(config);
  const gaps = await measurePeriod(spy, { count: 4, period: INTERVAL });
  assert.equal(gaps.length, 3);
  const feature = { external_id: 'ext:rt2:relay:r1:switch' };
  const ack = await gladys.fake.setValue({ external_id: 'ext:rt2:relay:r1' }, feature, 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(rt2.state.R[1], 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.lastState('ext:rt2:meter:ti1:energy-index'), 12345.678);
  app.stop();
  assert.ok(clock.timersSet < 60, `${clock.timersSet} timers`);
});
