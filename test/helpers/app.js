// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a fake Eco-Devices RT2 and the
// virtual clock of the shared test kit: every read of `now()` or
// `monotonic()` moves the time by 1 µs, so a decision reading the clock twice
// is caught.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { testClock } from '../kit/index.mjs';
import { Rt2App } from '../../src/app.js';
import { normalizeConfig } from '../../src/config.js';
import { buildDevice } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { KEY, fakeRt2 } from './fakeRt2.js';

export const SELECTOR = 'rt2';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const START = Date.UTC(2026, 9, 30, 12, 0, 0);
export const ADDRESS = '192.168.1.60';
export const CONFIG = { host: ADDRESS, api_key: KEY };

/** The external id of a feature: `F('relay', 'r1', 'switch')`. */
export const F = (kind, code, key) => `ext:${SELECTOR}:${kind}:${code}:${key}`;

/** A device as the user created it from the Discovery list. */
export function created(kind, code, { relayKind, feature, extra = [], id } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const n = Number(/(\d+)$/.exec(code)[1]);
  const device = buildDevice(gladys, { code, kind, n, feature }, { language: 'fr', relayKind });
  for (const key of extra) {
    const more = buildDevice(gladys, { code, kind, n }, { language: 'fr', relayKind: key });
    device.features.push(...more.features);
  }
  if (id) device.id = id;
  return device;
}

/** The salt of /data in the tests (the `random` of the app). */
export const SALT = '0123456789abcdef0123456789abcdef';

/** A /data that says the devices belong to the Eco-Devices of `raw` (its address and port). */
export function boundMemory(raw = CONFIG) {
  const config = normalizeConfig(raw);
  return {
    format: 1,
    salt: SALT,
    owner: { kind: 'address', id: config.key },
    key: config.key,
    guards: [],
    meters: {},
  };
}

/**
 * A proof that the box is an Eco-Devices RT2 that never expires: for the tests whose subject
 * is the order of the protective writes, not the product read before them (tested in
 * test/product.test.js).
 */
export const trustProduct = (app) => {
  app.productAt = Number.MAX_SAFE_INTEGER;
};

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

export async function setup({
  config = CONFIG,
  devices = [],
  store,
  clock = testClock({ start: START }),
  world = fakeRt2(),
  getConfig,
  fresh = false,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  if (getConfig) gladys.getConfig = getConfig;
  world.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const kept = store ?? memoryStore();
  // Unless asked for a fresh install: the devices given belong to the Eco-Devices configured.
  if (!fresh && kept.data === null) kept.data = boundMemory(config);
  const app = new Rt2App({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    transport: world.transport,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: kept,
    random: () => SALT,
  });
  registerHandlers(gladys, app, { error: log });
  const start = async (raw = config) => {
    await app.connected(raw);
    await wait(1000);
  };
  async function wait(ms) {
    await clock.advance(ms);
    await settle();
  }
  /** Awaits a promise while the virtual clock moves (10 ms steps). */
  const act = async (promise, max = 30_000) => {
    let done = false;
    const result = promise.then(
      (value) => {
        done = true;
        return { value };
      },
      (error) => {
        done = true;
        return { error };
      },
    );
    await settle();
    for (let t = 0; !done && t < max; t += 10) {
      await clock.advance(10);
      await settle(3);
    }
    if (!done) throw new Error('the promise did not settle');
    const { value, error } = await result;
    if (error) throw error;
    return value;
  };
  /** A command through the fake Gladys; its ack awaited while the clock moves. */
  const cmd = (device, featureId, value) => {
    const feature = device.features.find((f) => f.external_id === featureId);
    return act(gladys.fake.setValue(device, feature ?? { external_id: featureId }, value));
  };
  /** The states published for a feature (the values only). */
  const states = (featureId) =>
    gladys.fake.states
      .filter((s) => s.device_feature_external_id === featureId)
      .map((s) => s.state);
  /** The time since the start of the clock (ms). */
  const elapsed = () => clock.elapsed;
  return { app, gladys, clock, store: kept, world, start, wait, act, cmd, lines, states, elapsed };
}
