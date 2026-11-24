// -----------------------------------------------------------------------------
// "Read now" (cce66, t/11448 #27: "a button to force a read would be welcome"):
// one round at once whatever the poll interval, then the status and, for each
// listed pulse counter and power counter, the key read, the raw value and what
// was published. Never two rounds at once (a click during a round reports that
// round), never during a pause the Eco-Devices imposed, one click per 10 s
// (the cooldown of "Test the connection", shared), answered within 25 s.
// Also: the configuration fields, each refused entry said with what is wrong
// (cce66's "T1:EDF" and "C2", #25 and #27).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeConfig, parseClamps, parseCounters } from '../src/config.js';
import { T } from '../src/i18n.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, setup } from './helpers/app.js';

const meter = (code, feature = 'energy-index') =>
  created('meter', code, { feature, id: `id-${code}` });
const DEVICES = [meter('tore1'), meter('tore2'), meter('tore3'), meter('c1', 'water-index')];

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const OK = { product: 'EcoDevices_RT', status: 'Success' };

function world() {
  const w = fakeRt2();
  const all = { ...OK, Index_TI1: 132_533_718 };
  for (let n = 1; n <= 12; n += 1) all[`Index_C${n}`] = 0;
  for (let n = 1; n <= 20; n += 1) all[`Index_TORE${n}`] = 0;
  all.Index_C1 = 149_399;
  all.Index_TORE1 = 271_232;
  all.Index_TORE2 = '--      ';
  delete all.Index_TORE3;
  w.fixtures.set('all', all);
  return w;
}

const CFG = { ...CONFIG, clamps: 'T1, T2, T3', counters: 'C1:eau:l, C2:gaz:m3' };

test('the manifest declares the button', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
  );
  const action = manifest.actions.find((a) => a.key === 'read_now');
  assert.ok(action);
  assert.equal(action.label.fr, 'Lire maintenant');
  assert.equal(action.label.en, 'Read now');
  assert.equal(action.timeout_seconds, 30);
});

test('a click reads at once (the interval not waited), then reports each listed counter with its key, raw value and what became of it', async () => {
  const w = world();
  const { app, gladys, start, wait, act } = await setup({
    world: w,
    config: CFG,
    devices: DEVICES,
  });
  await start();
  await wait(2 * SECOND);
  const reads = () => w.reads().filter((r) => r.path.includes('Index=all')).length;
  const before = reads();
  const answer = await act(gladys.fake.action('read_now', {}));
  assert.equal(reads(), before + 1, 'one Index=all more, 2 s after the last round');
  const en = answer.data.message.en;
  assert.match(en, /^Connected to the Eco-Devices RT2/);
  assert.match(
    en,
    /\.\nTORE1 \(Index_TORE1\): 271232 read, converted to 271\.232 kWh, published\n/,
    'own line',
  );
  assert.match(en, /TORE2 \(Index_TORE2\): no value \("--"\) \[--\s*\]/);
  assert.match(en, /TORE3: key absent from the answer/);
  assert.match(en, /C1 \(Index_C1\): 149399 read, converted to 149\.399 m³, published/);
  assert.doesNotMatch(en, /Last read of the indexes/, 'the read of this click');
  assert.match(en, /C2 \(Index_C2\): 0, counts nothing yet \[0\]/);
  const fr = answer.data.message.fr;
  assert.match(fr, /TORE1 \(Index_TORE1\) : 271232 lu, converti en 271,232 kWh, publié/);
  assert.match(fr, /TORE3 : clé absente de la réponse/);
  assert.match(fr, /C2 \(Index_C2\) : 0, ne compte encore rien \[0\]/);
  // The next scheduled round follows the click, one interval later.
  await wait(14 * SECOND);
  assert.equal(reads(), before + 1);
  await wait(2 * SECOND);
  assert.equal(reads(), before + 2);
  app.stop();
});

test('one click per 10 s (shared with "Test the connection"): the second click answers with the last report, marked with its age, no round', async () => {
  const w = world();
  const { app, gladys, start, wait, act } = await setup({
    world: w,
    config: CFG,
    devices: DEVICES,
  });
  await start();
  await wait(20 * SECOND);
  const reads = () => w.reads().filter((r) => r.path.includes('Index=all')).length;
  const before = reads();
  const first = await act(gladys.fake.action('read_now', {}));
  assert.match(first.data.message.en, /TORE1 \(Index_TORE1\)/);
  assert.equal(reads(), before + 1);
  await wait(3 * SECOND);
  const second = await act(gladys.fake.action('read_now', {}));
  assert.equal(reads(), before + 1, 'no round for the second click');
  assert.match(
    second.data.message.en,
    /^One click per 10 s: try again in 7 s\. Connected .*\nLast read of the indexes 3 s ago \(not the read of this click\):\nTORE1 \(Index_TORE1\): 271232 read/s,
    'the last report, with its age',
  );
  assert.match(
    second.data.message.fr,
    /^Un clic par 10 s : réessayez dans 7 s\..*\nDernière lecture des index il y a 3 s/s,
  );
  await wait(3 * SECOND);
  const test = await act(gladys.fake.action('test_connection', {}));
  assert.equal(reads(), before + 1, 'the cooldown is shared');
  assert.doesNotMatch(test.data.message.en, /Index_TORE1/, 'the test does not list the counters');
  await wait(5 * SECOND);
  const third = await act(gladys.fake.action('read_now', {}));
  assert.equal(reads(), before + 2, '11 s after the first click: a round');
  assert.match(third.data.message.en, /TORE1 \(Index_TORE1\)/);
  assert.equal(w.peak, 1, 'never two requests at once');
  app.stop();
});

test('a click while a scheduled round runs reports that round ("already running: here is what it gave")', async () => {
  const w = world();
  w.latency = 2 * SECOND;
  const { app, gladys, start, wait, act } = await setup({ world: w, config: CFG });
  await start();
  await wait(15 * SECOND + 100);
  assert.ok(app.running, 'the round of the interval runs');
  const answer = await act(gladys.fake.action('read_now', {}));
  assert.match(
    answer.data.message.en,
    /^A read was already running: here is what it gave\. Connected/,
  );
  assert.match(answer.data.message.fr, /^Une lecture était déjà en cours/);
  assert.equal(w.peak, 1);
  app.stop();
});

test('during a pause the Eco-Devices imposed (429, failed reads): no read, said with the wait', async () => {
  const w = world();
  const { app, gladys, start, wait, act } = await setup({ world: w, config: CFG });
  await start();
  w.failReads = 429;
  await wait(15 * SECOND);
  w.failReads = undefined;
  await wait(11 * SECOND);
  const reads = () => w.reads().length;
  const before = reads();
  const answer = await act(gladys.fake.action('read_now', {}));
  assert.equal(reads(), before, 'nothing sent');
  assert.match(
    answer.data.message.en,
    /^The Eco-Devices asked to wait, or the last reads failed: no read for another \d+ s\./,
  );
  assert.doesNotMatch(
    answer.data.message.en,
    /Index_TORE1/,
    'no report of an older read without its age',
  );
  assert.match(answer.data.message.fr, /pas de lecture avant \d+ s/);
  app.stop();
});

test('nothing listed: the report says so; indexes unread: said', async () => {
  const w = world();
  const { app, gladys, start, wait, act } = await setup({ world: w, config: CONFIG });
  await start();
  await wait(11 * SECOND);
  const answer = await act(gladys.fake.action('read_now', {}));
  assert.match(answer.data.message.en, /\nNo pulse counter or power counter listed/);
  app.stop();
  const w2 = world();
  w2.failGroups.set('all', 500);
  const second = await setup({ world: w2, config: CFG });
  await second.start();
  await second.wait(11 * SECOND);
  const unread = await second.act(second.gladys.fake.action('read_now', {}));
  assert.match(unread.data.message.en, /The indexes \(Index=all\) were not read this time\./);
  second.app.stop();
});

test('no configuration: the button says what is missing, nothing read', async () => {
  const w = world();
  const { app, gladys, act } = await setup({ world: w, config: { host: '' } });
  await app.connected({ host: '' });
  const answer = await act(gladys.fake.action('read_now', {}));
  assert.match(answer.data.message.en, /Enter the address/);
  assert.equal(w.requests.length, 0);
  app.stop();
});

test('cce66 #25 and #27: each refused entry of the two fields is said with what is wrong, in French and English', () => {
  const clamps = parseClamps('T1:EDF, T2:Maison, T21, X1, T3:production, T3:injection, T4');
  assert.deepEqual(clamps.details, [
    { entry: 'T1:EDF', reason: 'mode', word: 'EDF' },
    { entry: 'T2:Maison', reason: 'mode', word: 'Maison' },
    { entry: 'T21', reason: 'number', word: undefined },
    { entry: 'X1', reason: 'format', word: undefined },
    { entry: 'TORE3', reason: 'twice' },
  ]);
  assert.equal(
    T.clampError(clamps.details[0]).fr,
    '« T1:EDF » : « EDF » n’est pas un mode (consommation, production, injection, soutirage ; un compteur différentiel n’est pas pris en charge : ne le listez pas) ; le nom se donne à l’appareil dans Gladys',
  );
  assert.equal(
    T.clampError(clamps.details[0]).en,
    '"T1:EDF": "EDF" is not a mode (consumption, production, injection, drawn; a differential counter is not supported: do not list it); a name is given to the device in Gladys',
  );
  assert.match(
    T.clampError(clamps.details[2]).fr,
    /^« T21 » : l’Eco-Devices RT2 n’a que les compteurs de puissance T1 à T20$/,
  );
  assert.match(
    T.clampError(clamps.details[3]).fr,
    /^« X1 » : attendu un compteur de puissance T1 à T20 et son mode/,
  );
  assert.match(
    T.clampError(clamps.details[4]).fr,
    /^« TORE3 » : donné deux fois avec des modes différents/,
  );
  const counters = parseCounters(
    'C1:Eau, C2, C3:huile, C4:gaz:kwh, C13:eau, R1, C5:eau:l, C5:eau:m3',
  );
  assert.deepEqual(counters.details, [
    { entry: 'C2', reason: 'missingType', word: undefined, unit: undefined },
    { entry: 'C3:huile', reason: 'type', word: 'huile', unit: undefined },
    { entry: 'C4:gaz:kwh', reason: 'unit', word: 'gaz', unit: 'kwh' },
    { entry: 'C13:eau', reason: 'number', word: 'eau', unit: undefined },
    { entry: 'R1', reason: 'format', word: undefined, unit: undefined },
    { entry: 'C5', reason: 'twice' },
  ]);
  assert.equal(
    T.counterError(counters.details[0]).fr,
    '« C2 » : il manque ce qu’il mesure (eau, gaz, électricité), par ex. « C2:gaz:m3 »',
  );
  assert.equal(
    T.counterError(counters.details[1]).en,
    '"C3:huile": "huile" is not something a counter measures (water, gas, electricity)',
  );
  assert.match(
    T.counterError(counters.details[2]).fr,
    /« kwh » n’est pas une unité de son index \(eau : l ou m3/,
  );
  assert.match(T.counterError(counters.details[3]).en, /pulse counters C1 to C12 only/);
  assert.match(T.counterError(counters.details[4]).en, /expected a pulse counter C1 to C12/);
  assert.match(T.counterError(counters.details[5]).en, /given twice with different settings/);
  // In the status: the entries, each with its reason.
  const config = normalizeConfig({ ...CONFIG, clamps: 'T1:EDF, T2, T3', counters: 'C1:eau, C2' });
  assert.equal(config.clamps.size, 2);
  assert.equal(config.counters.size, 1);
  assert.match(
    T.clampErrors(config.clampErrors).fr,
    /^Compteurs de puissance non compris : « T1:EDF » : « EDF » n’est pas un mode/,
  );
  assert.match(
    T.counterErrors(config.counterErrors).en,
    /^Pulse counters not understood: "C2": what it measures is missing/,
  );
});

test('cce66 #25: his "T1:EDF, T2, T3" and "C1:eau, C2" in the status after a round', async () => {
  const w = world();
  const { app, gladys, start, wait } = await setup({
    world: w,
    config: { ...CONFIG, clamps: 'T1:EDF, T2, T3', counters: 'C1:eau, C2' },
  });
  await start();
  await wait(15 * SECOND);
  const fr = message(gladys, 'fr');
  assert.match(
    fr,
    /Compteurs d’impulsions non compris : « C2 » : il manque ce qu’il mesure \(eau, gaz, électricité\)/,
  );
  assert.match(
    fr,
    /Compteurs de puissance non compris : « T1:EDF » : « EDF » n’est pas un mode \(consommation, production, injection, soutirage ;/,
  );
  assert.match(
    message(gladys),
    /"T1:EDF": "EDF" is not a mode \(consumption, production, injection, drawn;/,
  );
  app.stop();
});

test('the report says what became of each value: no device, feature missing, held back (the value Gladys keeps), /data failing', async () => {
  const w = world();
  w.TORE[1] = 0;
  // TORE2 created with the consumption feature, listed in production: the feature is missing.
  const devices = [meter('tore2'), meter('c1', 'water-index')];
  const { app, gladys, start, wait, act, states, store } = await setup({
    world: w,
    config: { ...CONFIG, clamps: 'T1, T2:production', counters: 'C1:eau:l' },
    devices,
  });
  await start();
  await wait(11 * SECOND);
  const first = await act(gladys.fake.action('read_now', {}));
  assert.deepEqual(states(F('meter', 'tore1', 'energy-index')), []);
  assert.match(
    first.data.message.en,
    /TORE1 \(Index_TORE1\): 271232 read, converted to 271\.232 kWh, not published: no device created in Gladys \(Discover\)/,
  );
  assert.match(
    first.data.message.fr,
    /TORE1 \(Index_TORE1\) : 271232 lu, converti en 271,232 kWh, non publié : aucun appareil créé dans Gladys \(Découverte\)/,
  );
  assert.match(first.data.message.en, /TORE2 \(Index_TORE2\): no value \("--"\)/);
  assert.match(
    first.data.message.en,
    /C1 \(Index_C1\): 149399 read, converted to 149\.399 m³, published/,
  );
  // TORE2 gets a value: its feature (production) is not on the device created (consumption).
  w.fixtures.get('all').Index_TORE2 = 5_000;
  await wait(11 * SECOND);
  const second = await act(gladys.fake.action('read_now', {}));
  assert.match(
    second.data.message.en,
    /TORE2 \(Index_TORE2\): 5000 read, converted to 5 kWh, not published: the feature is missing on the device \("Update" in Discover\)/,
  );
  // A jump of C1: held, the report says what Gladys keeps.
  w.fixtures.get('all').Index_C1 = 149_399 + 50_000_000;
  await wait(11 * SECOND);
  const third = await act(gladys.fake.action('read_now', {}));
  assert.match(
    third.data.message.en,
    /Index held back, not sent to Gladys: C1 149\.399 → 50,149\.399 m³/,
  );
  assert.match(
    third.data.message.en,
    /C1 \(Index_C1\): 50149399 read, converted to 50,149\.399 m³, held back \(Gladys keeps 149\.399 m³\)/,
  );
  assert.match(third.data.message.fr, /retenu \(Gladys garde 149,399 m³\)/);
  assert.equal(states(F('meter', 'c1', 'water-index')).at(-1), 149.399);
  // /data failing: nothing published, said.
  w.fixtures.get('all').Index_C1 = 149_399 + 10;
  store.save = async () => {
    throw new Error('disk full');
  };
  await wait(11 * SECOND);
  const fourth = await act(gladys.fake.action('read_now', {}));
  assert.match(
    fourth.data.message.en,
    /C1 \(Index_C1\): 149409 read, converted to 149\.409 m³, not published \(\/data\)/,
  );
  app.stop();
});

test('a click after Index=T failed: no exception, the power counters said unread; after a refused key: the older read is marked', async () => {
  const w = world();
  const all = w.fixtures.get('all');
  for (let n = 1; n <= 20; n += 1) delete all[`Index_TORE${n}`];
  w.failGroups.set('T', 500);
  const { app, gladys, start, wait, act } = await setup({
    world: w,
    config: CFG,
    devices: DEVICES,
  });
  await start();
  await wait(11 * SECOND);
  const answer = await act(gladys.fake.action('read_now', {}));
  assert.equal(answer.success, true, JSON.stringify(answer));
  assert.match(
    answer.data.message.en,
    /Not read this time \(no value published for them\): power counters \(Index=T\)\./,
  );
  assert.match(
    answer.data.message.en,
    /\nTORE1: not read this time \(Index=T\)\nTORE2: not read this time \(Index=T\)/,
  );
  assert.match(answer.data.message.fr, /\nTORE1 : non lu cette fois \(Index=T\)/);
  assert.match(
    answer.data.message.en,
    /C1 \(Index_C1\): 149399 read, converted to 149\.399 m³, published/,
  );
  // The key refused: the round fails; the report of the older read is marked with its age.
  w.key = 'another';
  await wait(11 * SECOND);
  const refused = await act(gladys.fake.action('read_now', {}));
  assert.match(refused.data.message.en, /refused the API key.*"Read now"/);
  assert.match(
    refused.data.message.en,
    /\nLast read of the indexes \d+ s ago \(not the read of this click\):\nTORE1: not read/,
  );
  app.stop();
});

test('app.tick({ now: true }) during a pause reads nothing (the pause of the Eco-Devices holds whatever the caller)', async () => {
  const w = world();
  const { app, start, wait, act } = await setup({ world: w, config: CFG });
  await start();
  w.failReads = 429;
  await wait(15 * SECOND);
  w.failReads = undefined;
  const before = w.requests.length;
  // Not awaited without a limit: a tick that read would hang the frozen clock (never a hang
  // of the test, always a failure).
  const tick = app.tick({ now: true, evenRefused: true });
  await wait(100);
  assert.equal(w.requests.length, before, 'nothing sent during the pause');
  await act(tick, 2 * SECOND);
  app.stop();
});
