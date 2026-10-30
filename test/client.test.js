// -----------------------------------------------------------------------------
// The client and its HTTP layer against a real local HTTP server (the shared
// kit): the key in the query only, never in an error; bounded answers; a
// protective request cuts a slow read and opens its connection once the
// read's is closed; one request at a time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { PRIORITY, Rt2Client } from '../src/rt2/client.js';
import { Rt2Error, errorReason } from '../src/rt2/http.js';
import { httpServer, reply } from './kit/index.mjs';

const KEY = 'K3y-Secret';

const client = (port, apiKey = KEY) => new Rt2Client({ host: '127.0.0.1', port, apiKey });

test('reads with the key in the query, JSON asked; a write needs "Success"; only the known queries', async (t) => {
  const srv = await httpServer({
    routes: {
      'GET /api/xdevices.json': (r) =>
        r.query.Get === 'R'
          ? { product: 'EcoDevices_RT', status: 'Success', R1: 1 }
          : { product: 'EcoDevices_RT', status: 'Error' },
    },
  });
  t.after(() => srv.close());
  const c = client(srv.port);
  const json = await c.read('Get=R');
  assert.equal(json.R1, 1);
  assert.equal(srv.requests[0].query.key, KEY);
  assert.match(srv.requests[0].headers.accept, /application\/json/);
  await assert.rejects(c.write('SetR=01', PRIORITY.COMMAND), (err) => {
    assert.equal(err.code, 'not_success');
    assert.equal(err.sent, true);
    return true;
  });
  for (const bad of ['SetR=01&Reset=1', 'SetFP00=3', 'SetFP09=3', 'SetR=11', 'SetC01=0', 'Reset']) {
    await assert.rejects(c.write(bad, PRIORITY.COMMAND), { code: 'bad_request' });
  }
  await assert.rejects(c.read('Get=all&SetR=01'), { code: 'bad_request' });
  assert.equal(srv.requests.length, 2, 'an invalid request never leaves');
});

test('no API key: no key parameter at all', async (t) => {
  const srv = await httpServer({
    routes: { 'GET /api/xdevices.json': { product: 'EcoDevices_RT', status: 'Success' } },
  });
  t.after(() => srv.close());
  await client(srv.port, '').read('Index=all');
  assert.equal(srv.requests[0].query.key, undefined);
  assert.equal(srv.requests[0].query.Index, 'all');
});

test('a write answered by another product is refused as such', async (t) => {
  const srv = await httpServer({
    routes: { 'GET /api/xdevices.json': { product: 'IPX800_V4', status: 'Success' } },
  });
  t.after(() => srv.close());
  await assert.rejects(client(srv.port).write('ClearR=01', PRIORITY.PROTECTIVE), {
    code: 'wrong_product',
  });
});

test('statuses: 401 refused, 503 busy, 500 http, a text not JSON; the key and address never in a message', async (t) => {
  let answer = 0;
  const answers = [reply(401, { status: 'Error' }), reply(500, 'oops'), 'not json at all'];
  const srv = await httpServer({
    routes: { '/api/xdevices.json': () => answers[answer++] },
  });
  t.after(() => srv.close());
  const c = client(srv.port);
  const errors = [];
  for (let i = 0; i < 3; i += 1) errors.push(await c.read('Get=R').catch((err) => err));
  srv.status5xx = 1;
  errors.push(await c.read('Get=R').catch((err) => err));
  assert.deepEqual(
    errors.map((e) => e.code),
    ['refused', 'http', 'bad_response', 'busy'],
  );
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  errors.push(
    await client(port)
      .read('Get=R')
      .catch((err) => err),
  );
  assert.equal(errors.at(-1).code, 'network');
  assert.equal(errors.at(-1).sent, false);
  for (const err of errors) {
    const text = `${err.message} ${errorReason(err)} ${err.stack}`;
    assert.ok(!text.includes(KEY), text);
    assert.ok(!text.includes('127.0.0.1'), text);
  }
});

test('an answer over the limit is cut before it is read whole', async (t) => {
  const srv = await httpServer({
    routes: { '/api/xdevices.json': { status: 'Success' } },
    bigBody: 200_000,
  });
  t.after(() => srv.close());
  await assert.rejects(client(srv.port).read('Index=all'), { code: 'size' });
});

test('a silent Eco-Devices: timeout at the deadline, "sent"', async (t) => {
  const srv = await httpServer({ routes: { '/api/xdevices.json': 'silent' } });
  t.after(() => srv.close());
  const c = client(srv.port);
  const started = performance.now();
  const err = await c
    .read('Get=R', PRIORITY.READ, { deadline: performance.now() + 300 })
    .catch((e) => e);
  assert.equal(err.code, 'timeout');
  assert.equal(err.sent, true);
  assert.ok(performance.now() - started < 1500);
});

test('a protective request cuts a slow read, after its connection is closed; one request at a time', async (t) => {
  let open = 0;
  let peak = 0;
  const srv = await httpServer({
    latencyMs: (r) => (r.query.Get === 'D' ? 5000 : 10),
    routes: { '/api/xdevices.json': { product: 'EcoDevices_RT', status: 'Success' } },
  });
  t.after(() => srv.close());
  const c = new Rt2Client({
    host: '127.0.0.1',
    port: srv.port,
    apiKey: KEY,
    // Counts the requests open at once, from the client side (open -> settled).
    transport: async (options, hooks) => {
      const { request } = await import('../src/rt2/http.js');
      open += 1;
      peak = Math.max(peak, open);
      try {
        return await request(options, hooks);
      } finally {
        open -= 1;
      }
    },
  });
  const read = c
    .read('Get=D', PRIORITY.READ, { deadline: performance.now() + 10_000 })
    .catch((e) => e);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = performance.now();
  await c.write('SetFP01=3', PRIORITY.PROTECTIVE);
  const took = performance.now() - started;
  const err = await read;
  assert.ok(err instanceof Rt2Error);
  assert.equal(err.code, 'cut');
  assert.ok(took < 1000, `the protective write took ${Math.round(took)} ms`);
  assert.equal(peak, 1, 'never two requests open at once');
  assert.equal(srv.requests.length, 2);
});

test('a server keeping the connection open: one connection at a time, the next opened after', async (t) => {
  const { tcpServer } = await import('./kit/index.mjs');
  const { request } = await import('../src/rt2/http.js');
  const text = JSON.stringify({ product: 'EcoDevices_RT', status: 'Success', R1: 0 });
  const dev = await tcpServer({
    onData: (c) =>
      c.toString('latin1').startsWith('GET')
        ? `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${text.length}\r\n\r\n${text}`
        : undefined,
  });
  t.after(() => dev.close());
  // Measured on the client side: a request settles once its own socket is closed, so two
  // requests open at once would mean two sockets. (The server sees the close a little later:
  // under load its own count may overlap by a few ms, which says nothing of the client.)
  let open = 0;
  let peak = 0;
  const c = new Rt2Client({
    host: '127.0.0.1',
    port: dev.port,
    apiKey: KEY,
    transport: async (options, hooks) => {
      open += 1;
      peak = Math.max(peak, open);
      try {
        return await request(options, hooks);
      } finally {
        open -= 1;
      }
    },
  });
  await c.read('Get=R');
  await c.read('Get=R');
  await Promise.all([
    c.write('ClearR=01', PRIORITY.PROTECTIVE).catch(() => {}),
    c.write('ClearR=02', PRIORITY.PROTECTIVE).catch(() => {}),
    c.read('Get=R').catch(() => {}),
  ]);
  assert.equal(dev.connections, 5);
  assert.equal(peak, 1, 'never two connections open at once');
});

test('the lane waits a little after a request before opening the next connection', async () => {
  const { testClock } = await import('./kit/index.mjs');
  const { TIMINGS } = await import('../src/constants.js');
  const clock = testClock();
  const started = [];
  const c = new Rt2Client({
    host: '127.0.0.1',
    port: 1,
    apiKey: KEY,
    monotonic: clock.monotonic,
    timers: clock.timers,
    transport: async () => {
      started.push(clock.elapsed);
      return { status: 200, body: Buffer.from('{"status":"Success"}') };
    },
  });
  const both = Promise.all([c.read('Get=R'), c.read('Get=R')]);
  await clock.advance(1);
  await clock.advance(TIMINGS.laneGap / 2);
  assert.equal(started.length, 1, 'the second waits');
  await clock.advance(TIMINGS.laneGap);
  await both;
  assert.equal(started.length, 2);
  assert.ok(started[1] - started[0] >= TIMINGS.laneGap);
});
