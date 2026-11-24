// -----------------------------------------------------------------------------
// Every way a power counter (`Index_TORE<n>`) can come without a value on
// firmware 3, and the spellings of the keys: fixtures RECONSTRUCTED FROM THE
// DOCUMENTATION, not read on a real RT2 (cce66's raw `Index=all` of t/11448
// #28 was not there yet). Sources (2026-11-24):
//   - GCE wiki "API EDRT" (API v2.00.33, 2018-07-01): `Index=all` "retourne tous
//     les index" (JSON only), `Index=T` the "16 tores, même non câblées" (the
//     command of the 2017 PDF too); no key name, no unit, no "--" documented;
//   - GCE forum 15493 (firmware 3.0, 2022-06): Julien_GCE 2022-06-16: 20
//     "compteurs de puissance", each bound to a clamp of the RT2, of an X-400
//     or to another counter, modes consommation / production / soutiré /
//     injecté, unit kWh (default) or kVAh; Chris_eco 2022-06-17: `Index=T`
//     answers `Index_TORE1`..`20`, 0 for the counters not bound; loulou2626
//     2022-06-24: "les compteurs de puissances sont unidirectionnelles" (a
//     clamp facing the wrong way counts nothing); Julien_GCE 2022-06-27: an
//     index stays at 0 when no sub-post/clamp feeds it;
//   - Jeedom community 87420 (loic69, 2022-07-21): on firmware 3 the keys are
//     `Index_TOREx`, "différentes de l'ancien firmware où il y avait un
//     underscore avant le nombre" (`Index_TORE_x`); firmware 2 answered
//     `Index_TORE_Cons1-4`, `Index_TORE_Dist1-4`, `Index_TORE5-16`;
//   - HACF forum 48863 (cocof, 2024-10-17): `Get=all` spells the pulse counters
//     `INDEX_C1` (upper case);
//   - cce66's status.json (t/11448 #19, firmware 3.00.04): a power counter
//     bound to no clamp shows `"--      "`; his `Index=all` of #7: an entry
//     with nothing behind it is 4294967295.
// Hence: a key is found whatever its case and underscore; null, "", "--", 0,
// 4294967295 and a text are "no value" with their reason; power counters absent
// from `Index=all` are read by `Index=T`; firmware 2 reads none. Never 0.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasToreKeys, indexEntry, isFirmware2Indexes } from '../src/rt2/model.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const meter = (code, feature = 'energy-index') =>
  created('meter', code, { feature, id: `id-${code}` });

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const TORE = (n, feature = 'energy-index') => F('meter', `tore${n}`, feature);
const OK = { product: 'EcoDevices_RT', status: 'Success' };

/** `Index=all` reconstructed from the docs: TI1, C1..12, TORE1..20 given. */
function indexAll(tores = {}) {
  const out = { ...OK, Index_TI1: 132_533_718 };
  for (let n = 1; n <= 12; n += 1) out[`Index_C${n}`] = 0;
  for (let n = 1; n <= 20; n += 1) out[`Index_TORE${n}`] = 0;
  return { ...out, ...tores };
}

function worldWith(all, tores) {
  const world = fakeRt2();
  world.fixtures.set('all', all);
  if (tores) world.fixtures.set('T', tores);
  return world;
}

test('indexEntry: the key whatever its spelling (Index_TORE_3, INDEX_TORE3, index_tore3, INDEX_C1), and why there is no value', () => {
  const exact = indexEntry({ Index_TORE3: 1_654_075 }, 'tore3');
  assert.deepEqual(exact, { key: 'Index_TORE3', raw: 1_654_075, why: undefined });
  assert.equal(
    indexEntry({ Index_TORE_3: 12 }, 'tore3').key,
    'Index_TORE_3',
    'firmware 2 spelling',
  );
  assert.equal(indexEntry({ INDEX_TORE3: 12 }, 'tore3').key, 'INDEX_TORE3');
  assert.equal(indexEntry({ index_tore3: 12 }, 'tore3').key, 'index_tore3');
  assert.equal(indexEntry({ INDEX_C1: 149_399 }, 'c1').key, 'INDEX_C1', 'Get=all spelling');
  assert.equal(indexEntry({ Index_TI1: 5 }, 'ti1').key, 'Index_TI1');
  // Never another number: TORE3 is not TORE30, TORE13 nor TORE_30.
  assert.equal(
    indexEntry({ Index_TORE30: 1, Index_TORE13: 1, Index_TORE_30: 1 }, 'tore3').why,
    'absent',
  );
  assert.equal(indexEntry({ Index_TORE_Cons3: 1 }, 'tore3').why, 'absent');
  assert.equal(indexEntry({ Index_TORE3: '12' }, 'tore3').why, undefined, 'a decimal text is read');
  for (const raw of [null, '', '--', '--      ', '-', 'N/A', 'null']) {
    assert.equal(indexEntry({ Index_TORE3: raw }, 'tore3').why, 'empty', JSON.stringify(raw));
  }
  assert.equal(indexEntry({ Index_TORE3: 0 }, 'tore3').why, 'zero');
  assert.equal(indexEntry({ Index_TORE3: '0' }, 'tore3').why, 'zero');
  assert.equal(indexEntry({ Index_TORE3: 4_294_967_295 }, 'tore3').why, 'unbound');
  assert.equal(indexEntry({ Index_TORE3: '4294967295' }, 'tore3').why, 'unbound');
  for (const raw of ['abc', -5, 1e14, true, {}, [], 'NaN']) {
    assert.equal(indexEntry({ Index_TORE3: raw }, 'tore3').why, 'unreadable', JSON.stringify(raw));
  }
  assert.equal(indexEntry({}, 'tore3').why, 'absent');
  assert.equal(indexEntry(null, 'tore3').why, 'absent');
  assert.equal(indexEntry({ Index_TORE3: 1 }, 'r1').why, 'absent', 'not a meter');
  // Nothing from the prototype.
  assert.equal(indexEntry(Object.create({ Index_TORE3: 7 }), 'tore3').why, 'absent');
  assert.equal(hasToreKeys({ Index_TORE1: 0 }), true);
  assert.equal(
    hasToreKeys({ Index_TORE_Cons1: 0 }),
    false,
    'a clamp of firmware 2 is no power counter',
  );
  assert.equal(hasToreKeys({ Index_TI1: 0 }), false);
  assert.equal(isFirmware2Indexes({ Index_TORE_Dist2: 0 }), true);
  assert.equal(isFirmware2Indexes({ Index_TORE1: 0 }), false);
});

test('reconstructed: the keys in another spelling (Index_TORE_1, INDEX_C1) are read all the same', async () => {
  const all = indexAll();
  delete all.Index_TORE1;
  delete all.Index_C1;
  all.Index_TORE_1 = 1_654_075;
  all.INDEX_C1 = 149_399;
  const { app, gladys, start, wait, states } = await setup({
    world: worldWith(all),
    config: { ...CONFIG, clamps: 'T1', counters: 'C1:eau:l' },
    devices: [meter('tore1'), meter('c1', 'water-index')],
  });
  await start();
  await wait(15 * SECOND);
  assert.deepEqual(states(TORE(1)), [1654.075]);
  assert.deepEqual(states(F('meter', 'c1', 'water-index')), [149.399]);
  assert.doesNotMatch(message(gladys), /without a value/);
  app.stop();
});

test('reconstructed: each reason for no value is said as such (absent, "--", null, 0, 4294967295, a text), in English and French', async () => {
  const all = indexAll({
    Index_TORE2: '--      ',
    Index_TORE3: null,
    Index_TORE4: 0,
    Index_TORE5: 4_294_967_295,
    Index_TORE6: 'kVAh',
  });
  delete all.Index_TORE1;
  const { app, gladys, start, wait, states } = await setup({
    world: worldWith(all),
    config: { ...CONFIG, clamps: 'T1, T2, T3, T4, T5, T6' },
    devices: [1, 2, 3, 4, 5, 6].map((n) => meter(`tore${n}`)),
  });
  await start();
  await wait(15 * SECOND);
  for (let n = 1; n <= 6; n += 1) assert.deepEqual(states(TORE(n)), [], `TORE${n}: never 0`);
  const en = message(gladys);
  assert.match(en, /TORE1: key absent from the Index=all answer/);
  assert.match(en, /TORE2, TORE3: value "--" \(a power counter bound to no clamp/);
  assert.match(
    en,
    /TORE4: value 0 \(the counter counted nothing yet: no clamp bound to it, a clamp facing the wrong way/,
  );
  assert.match(en, /TORE5: value 4294967295 \(an entry with nothing behind it\)/);
  assert.match(en, /TORE6: value not understood/);
  const fr = message(gladys, 'fr');
  assert.match(fr, /TORE1 : clé absente de la réponse Index=all/);
  assert.match(fr, /TORE2, TORE3 : valeur « -- » \(compteur de puissance relié à aucune pince/);
  assert.match(fr, /derrière\) ; TORE6 : valeur non comprise/, 'French separators');
  assert.match(fr, /TORE4 : valeur 0 \(le compteur n’a encore rien compté/);
  assert.match(fr, /TORE6 : valeur non comprise/);
  assert.doesNotMatch(en, /Index=T/, 'Index=all held the power counters: no second command');
  app.stop();
});

test('reconstructed: Index=all without any Index_TORE key and power counters listed: Index=T read too (the 2017 PDF command), said in the status', async () => {
  const all = indexAll();
  for (let n = 1; n <= 20; n += 1) delete all[`Index_TORE${n}`];
  const tores = { ...OK };
  for (let n = 1; n <= 20; n += 1) tores[`Index_TORE${n}`] = 0;
  tores.Index_TORE1 = 1_433_755;
  const world = worldWith(all, tores);
  const { app, gladys, start, wait, states } = await setup({
    world,
    config: { ...CONFIG, clamps: 'T1, T2' },
    devices: [meter('tore1'), meter('tore2')],
  });
  await start();
  await wait(15 * SECOND);
  assert.ok(
    world.requests.some((r) => r.path.includes('Index=T')),
    'Index=T sent',
  );
  assert.deepEqual(states(TORE(1)), [1433.755]);
  assert.deepEqual(states(TORE(2)), []);
  assert.match(message(gladys), /not in Index=all on this Eco-Devices: read with Index=T instead/);
  assert.match(message(gladys), /TORE2: value 0/);
  assert.match(message(gladys, 'fr'), /lus par Index=T à la place/);
  // Index=T failing: the power counters unread (never 0), the rest published.
  world.failGroups.set('T', 500);
  world.TORE[1] = 0;
  await wait(15 * SECOND);
  assert.deepEqual(states(TORE(1)), [1433.755], 'nothing new');
  assert.match(
    message(gladys),
    /Not read this time \(no value published for them\): power counters \(Index=T\)\./,
  );
  assert.doesNotMatch(message(gladys), /key absent/, 'unread, not absent');
  app.stop();
});

test('reconstructed: no power counter listed: Index=T is never sent, even without Index_TORE keys', async () => {
  const all = indexAll();
  for (let n = 1; n <= 20; n += 1) delete all[`Index_TORE${n}`];
  const world = worldWith(all, { ...OK, Index_TORE1: 5 });
  const { app, start, wait } = await setup({ world, config: { ...CONFIG, counters: 'C1:eau' } });
  await start();
  await wait(15 * SECOND);
  assert.ok(!world.requests.some((r) => r.path.includes('Index=T')));
  app.stop();
});
