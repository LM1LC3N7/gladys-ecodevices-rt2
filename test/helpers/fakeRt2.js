// -----------------------------------------------------------------------------
// A fake Eco-Devices RT2 behind the transport of the client (no network), on
// the virtual clock of the tests: each request takes `latency` ms of that
// clock (a timer), may take a while to connect (a cut then: nothing left),
// can be cut (onStart), times out at its deadline, applies a write when it
// is received, and records everything. It also counts the requests in flight
// at once (`peak`): the lane must keep it at 1.
//
// GET /api/xdevices.json?key=<key>&Get=R|D|FP|XTHL | Index=all | SetR=NN |
// ClearR=NN | SetFPNN=c, every answer with `product` and `status`.
// -----------------------------------------------------------------------------

import { Rt2Error } from '../../src/rt2/http.js';

export const KEY = 'S3cretKey-42';

export const FP_TEXT = ['Confort', 'Eco', 'Hors Gel', 'Arret', 'Confort -1', 'Confort -2'];

/** The answer of one group, as the fake would give it now. */
export function answerOf(world, query) {
  const ok = { product: world.product, status: 'Success' };
  const out = { ...ok };
  if (query === 'R') for (let n = 1; n <= 10; n += 1) out[`R${n}`] = world.R[n];
  else if (query === 'D') for (let n = 1; n <= 12; n += 1) out[`D${n}`] = world.D[n];
  else if (query === 'FP') {
    for (let n = 1; n <= 16; n += 1) {
      out[`FP${Math.floor((n - 1) / 4) + 1} Zone ${((n - 1) % 4) + 1}`] = world.FP[n];
    }
  } else if (query === 'XTHL') {
    for (const [n, thl] of Object.entries(world.THL)) {
      out[`THL${n}-TEMP`] = thl.TEMP;
      out[`THL${n}-HUM`] = thl.HUM;
      out[`THL${n}-LUM`] = thl.LUM;
    }
  } else if (query === 'all') {
    for (let n = 1; n <= 7; n += 1) out[`Index_TI${n}`] = world.TI[n];
    for (let n = 1; n <= 16; n += 1) out[`Index_TORE${n}`] = world.TORE[n];
    for (let n = 1; n <= 12; n += 1) out[`Index_C${n}`] = world.C[n];
  }
  return out;
}

export function fakeRt2(options = {}) {
  const { key = KEY } = options;
  const world = {
    key,
    product: 'EcoDevices_RT',
    requests: [],
    inFlight: 0,
    peak: 0,
    /** ms of the virtual clock per request, or a function of the request. */
    latency: 20,
    /** Answers to give first: an Rt2Error | { status, json } | (req) => answer | undefined. */
    queue: [],
    /** Writes accepted but not applied (the Eco-Devices answers Success, nothing changes). */
    ignoreWrites: false,
    /** Connections refused before anything leaves, for this many requests. */
    refuseConnect: 0,
    /** ms (or a function of the request) to connect: a cut meanwhile means nothing left. */
    connectDelay: 0,
    clock: undefined,
    R: Array(11).fill(0),
    D: Array(13).fill(0),
    FP: Array(17).fill('Arret'),
    THL: { 1: { TEMP: 21.5, HUM: 45, LUM: 300 } },
    /** Wh. */
    TI: [0, 12_345_678, 2_345_678, 0, 0, 0, 0, 0],
    /** Wh. */
    TORE: Array(17).fill(0),
    C: Array(13).fill(0),
    /** Every read (not the writes) answers this status when set. */
    failReads: undefined,
    /** Groups that fail: 'FP' -> status. */
    failGroups: new Map(),
    sleep(ms) {
      return new Promise((resolve) => world.clock.timers.setTimeout(resolve, ms));
    },
    transport: (options, hooks) => transport(world, options, hooks),
    writes() {
      return world.requests.filter((r) => /Set|Clear/.test(r.path));
    },
    reads() {
      return world.requests.filter((r) => !/Set|Clear/.test(r.path));
    },
  };
  world.TORE[1] = 456_789;
  world.C[1] = 123_456;
  return world;
}

const json = (body, status = 200) => ({ status, body: Buffer.from(JSON.stringify(body), 'utf8') });

async function transport(
  world,
  options,
  { monotonic, deadline, maxBytes, beforeSend, onSent, onStart },
) {
  const record = {
    method: options.method,
    path: options.path,
    at: monotonic(),
  };
  world.requests.push(record);
  world.inFlight += 1;
  world.peak = Math.max(world.peak, world.inFlight);
  let sent = false;
  let cut;
  const cutPromise = new Promise((_, reject) => {
    cut = () => reject(new Rt2Error('cut', 'cut by a protective command', { sent }));
  });
  cutPromise.catch(() => {});
  onStart?.(() => cut());
  try {
    const connect =
      typeof world.connectDelay === 'function' ? world.connectDelay(record) : world.connectDelay;
    if (connect > 0) await Promise.race([world.sleep(connect), cutPromise]);
    if (deadline !== undefined && monotonic() >= deadline) {
      throw new Rt2Error('late', 'no time left to send');
    }
    if (world.refuseConnect > 0) {
      world.refuseConnect -= 1;
      throw new Rt2Error('network', 'connection refused', { reason: 'ECONNREFUSED' });
    }
    beforeSend?.();
    if (deadline !== undefined && monotonic() >= deadline) {
      throw new Rt2Error('late', 'no time left to send');
    }
    sent = true;
    onSent?.();
    record.sentAt = monotonic();
    const latency = typeof world.latency === 'function' ? world.latency(record) : world.latency;
    const left = deadline === undefined ? Infinity : deadline - monotonic();
    const answer = respond(world, record);
    if (latency > 0 || left < Infinity) {
      const outcome = await Promise.race([
        world.sleep(Math.min(latency, left)).then(() => (latency >= left ? 'timeout' : 'ok')),
        cutPromise,
      ]);
      if (outcome === 'timeout') {
        throw new Rt2Error('timeout', 'no answer in time', { sent: true });
      }
    }
    record.end = monotonic();
    if (answer instanceof Error) throw answer;
    if (maxBytes !== undefined && answer.body.length > maxBytes) {
      throw new Rt2Error('size', 'answer too large', { sent: true });
    }
    return answer;
  } finally {
    world.inFlight -= 1;
  }
}

function respond(world, record) {
  let next = world.queue.shift();
  if (typeof next === 'function') next = next(record);
  if (next instanceof Error) return next;
  if (next) return json(next.json ?? {}, next.status ?? 200);
  const url = new URL(record.path, 'http://rt2');
  const write = /Set|Clear/.test(record.path);
  if (url.pathname !== '/api/xdevices.json') return json({}, 404);
  if (world.key !== '' && url.searchParams.get('key') !== world.key) {
    return json({ status: 'Error' }, 401);
  }
  if (world.failReads && !write) return json({}, world.failReads);
  const params = url.searchParams;
  const group = params.get('Get') ?? (params.get('Index') === 'all' ? 'all' : undefined);
  if (group) {
    if (world.failGroups.has(group)) return json({}, world.failGroups.get(group));
    return json(answerOf(world, group));
  }
  const ok = { product: world.product, status: 'Success' };
  for (const [name, value] of params) {
    let m;
    if (name === 'SetR' || name === 'ClearR') {
      if (!world.ignoreWrites) world.R[Number(value)] = name === 'SetR' ? 1 : 0;
      return json(ok);
    }
    if ((m = /^SetFP(\d{2})$/.exec(name))) {
      if (!world.ignoreWrites) world.FP[Number(m[1])] = FP_TEXT[Number(value)];
      return json(ok);
    }
  }
  return json({ product: world.product, status: 'Error' });
}
