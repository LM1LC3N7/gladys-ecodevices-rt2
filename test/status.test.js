// -----------------------------------------------------------------------------
// The full status of a real Eco-Devices RT2 (cce66, community thread t/11448,
// post 19, 2026-11-14): `GET /admin/status.json`, firmware 3.00.04, kept in
// test/fixtures/cce66-status-3.00.04.json (its MAC address masked, the
// teleinformation index replaced by 123456789; ADCO already 0 as he gave it).
//
// The integration never reads this file: it is the page of the web interface
// (behind the user / admin password, `"product": "EcoDevices RT2"`), not the
// API (`/api/xdevices.json`, `"product": "EcoDevices_RT"`, answered by the same
// firmware: posts 7 and 9). It gives the same values under other names, so it
// checks what the API reads mean on that box:
//   rly (10 chars) = Get=R R1..R10, in (12) = Get=D D1..D12,
//   x4fp1z / x4fp2z (z 1..4) = Get=FP zones (255 here: no X-4FP, never a mode),
//   indexcourant64x (x 0..6) = Index_TI1..7 (Wh; 132833958 for TI1 on his box,
//   300 kWh more than Index_TI1 on 2026-10-31: the same index, in Wh),
//   indexcourant5x = Index_TORE1..16, indexcourant3x = Index_C1..12,
//   "--      " = no value (never 0).
// The teleinformation labels (etiquetteN / etiquetteValN: OPTARIF, ISOUSC,
// PTEC, IINST, IMAX, PAPP; BASE reads 000000000 while the index is above 0),
// the posts, sub-posts, prices, virtual outputs, EnOcean and vmesure are not
// in what the integration reads (milestone 2 in TODO.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkEnvelope, indexNumber, meterOf, valueOf, zoneIsNumber } from '../src/rt2/model.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const STATUS = JSON.parse(
  readFileSync(new URL('./fixtures/cce66-status-3.00.04.json', import.meta.url), 'utf8'),
);

const ok = { product: 'EcoDevices_RT', status: 'Success' };

/** The API answers the same box would give, built from its status.json. */
function apiOf(status) {
  const R = { ...ok };
  for (let n = 1; n <= 10; n += 1) R[`R${n}`] = Number(status.rly[n - 1]);
  const D = { ...ok };
  for (let n = 1; n <= 12; n += 1) D[`D${n}`] = Number(status.in[n - 1]);
  const FP = { ...ok };
  for (const x of [1, 2]) {
    for (let z = 1; z <= 4; z += 1) FP[`FP${x} Zone ${z}`] = Number(status[`x4fp${x}${z}`]);
  }
  // The texts as they are ("--      " included): what a firmware giving them would answer.
  const all = { ...ok };
  for (let n = 1; n <= 7; n += 1) all[`Index_TI${n}`] = status[`indexcourant64${n - 1}`];
  for (let n = 1; n <= 16; n += 1) all[`Index_TORE${n}`] = status[`indexcourant5${n - 1}`];
  for (let n = 1; n <= 12; n += 1) all[`Index_C${n}`] = status[`indexcourant3${n - 1}`];
  return { R, D, FP, all };
}

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';

test('his status.json: firmware 3.00.04, the masked fields, not an API answer', () => {
  assert.equal(STATUS.product, 'EcoDevices RT2');
  assert.equal(STATUS.infofirm, '3.00.04');
  assert.equal(STATUS.configmac, 'XX:XX:XX:XX:XX:XX');
  assert.equal(STATUS.etiquette0, 'ADCO');
  assert.match(STATUS.etiquetteVal0, /^0+$/);
  // Another product name than the API's: never taken for an API answer.
  assert.equal(checkEnvelope(STATUS).error, 'wrong_product');
  const api = apiOf(STATUS);
  for (const json of Object.values(api)) assert.deepEqual(checkEnvelope(json), { ok: true });
});

test('his status.json, read as the API: relays, inputs off; 255 is no mode; "--" and 0 are no index', () => {
  const api = apiOf(STATUS);
  for (let n = 1; n <= 10; n += 1) assert.equal(valueOf(api.R, 'relay', n), 0, `R${n}`);
  for (let n = 1; n <= 12; n += 1) assert.equal(valueOf(api.D, 'input', n), 0, `D${n}`);
  for (let n = 1; n <= 8; n += 1) {
    assert.equal(zoneIsNumber(api.FP, n), true);
    assert.equal(valueOf(api.FP, 'pilot-wire', n), undefined, `FP${n}: 255 is no mode`);
  }
  assert.equal(meterOf('ti1', api.all.Index_TI1).value, 123456.789, 'Wh read, kWh published');
  for (const raw of ['--      ', '--', ' ', '', '-']) {
    assert.equal(indexNumber(raw), undefined, JSON.stringify(raw));
    assert.equal(meterOf('ti2', raw).value, undefined);
  }
  // BASE of the labels reads 000000000 while the index is above 0: a 0 is never published.
  assert.equal(STATUS.etiquette3, 'BASE');
  assert.equal(meterOf('ti1', STATUS.etiquetteVal3).value, undefined);
  const counters = new Map([['c1', { type: 'electricity', unit: 'wh' }]]);
  assert.equal(meterOf('c1', api.all.Index_C1, counters).value, undefined);
  // The other values of the labels are texts or codes, none of them an index.
  assert.equal(STATUS.etiquetteVal15, 'TH..');
  assert.equal(meterOf('ti1', STATUS.etiquetteVal15).value, undefined);
});

test('his box, through the integration: what Discover lists and what Gladys shows', async () => {
  const api = apiOf(STATUS);
  const world = fakeRt2();
  world.fixtures.set('R', api.R);
  world.fixtures.set('D', api.D);
  world.fixtures.set('FP', api.FP);
  world.fixtures.set('all', api.all);
  const devices = [
    created('meter', 'ti1', { feature: 'energy-index', id: 'id-ti1' }),
    created('meter', 'ti2', { feature: 'energy-index', id: 'id-ti2' }),
    created('meter', 'c1', { feature: 'energy-index', id: 'id-c1' }),
    created('relay', 'r1'),
    created('input', 'd1'),
    created('pilot-wire', 'fp1'),
  ];
  const { app, gladys, start, wait, states } = await setup({
    world,
    devices,
    config: { ...CONFIG, extensions: 'FP1-FP8', counters: 'C1:electricity:wh' },
  });
  await start();
  await wait(15 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys), /10 relay\(s\), 12 input\(s\)/);
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  for (let n = 1; n <= 10; n += 1) assert.ok(ids.includes(`ext:rt2:relay:r${n}`), `R${n}`);
  for (let n = 1; n <= 12; n += 1) assert.ok(ids.includes(`ext:rt2:input:d${n}`), `D${n}`);
  for (let n = 1; n <= 8; n += 1) assert.ok(ids.includes(`ext:rt2:pilot-wire:fp${n}`), `FP${n}`);
  assert.ok(ids.includes('ext:rt2:meter:ti1'));
  // TI2 and C1 are listed because they exist in Gladys; the others are not offered.
  for (const n of [3, 4, 5, 6, 7]) assert.ok(!ids.includes(`ext:rt2:meter:ti${n}`), `TI${n}`);
  assert.ok(!ids.some((id) => /meter:(tore\d|c([2-9]|1[0-2])$)/.test(id)), ids.join(' '));
  // What Gladys shows.
  assert.equal(gladys.fake.lastState(F('meter', 'ti1', 'energy-index')), 123456.789);
  assert.deepEqual(states(F('meter', 'ti2', 'energy-index')), [], '"--" is never published');
  assert.deepEqual(states(F('meter', 'c1', 'energy-index')), [], '"--" is never published');
  assert.equal(gladys.fake.lastState(F('relay', 'r1', 'readonly')), 0);
  assert.equal(gladys.fake.lastState(F('input', 'd1', 'state')), 0);
  assert.deepEqual(states(F('pilot-wire', 'fp1', 'mode')), [], '255 is never a mode');
  assert.match(message(gladys), /answering no known mode .*FP1/);
  assert.ok(
    gladys.fake.states.every((s) => Number.isFinite(s.state)),
    'no NaN, no text published',
  );
  app.stop();
});
