// -----------------------------------------------------------------------------
// Relays read only by default must say so, and say what to do (list them,
// then "Update" in Discovery). Taken from gladys-ipx800 (its review after
// cce66's first test on a real IPX800).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from '../src/i18n.js';
import { fakeRt2 } from './helpers/fakeRt2.js';
import { CONFIG, F, SECOND, created, settle, setup } from './helpers/app.js';

const message = (gladys, lang = 'en') => gladys.fake.connectionStatus?.message?.[lang] ?? '';
const discovered = (gladys, code) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === `ext:rt2:relay:${code}`);

test('one relay listed: no "read only" hint any more (the others stay read only, silently)', async () => {
  const { app, gladys, start } = await setup({ config: { ...CONFIG, relays: 'R1' } });
  await start();
  assert.doesNotMatch(message(gladys), /read only/);
  assert.doesNotMatch(message(gladys, 'fr'), /lecture seule/);
  assert.equal(discovered(gladys, 'r2').features[0].read_only, true);
  app.stop();
});

test('relays listed after their creation: the status names those waiting for "Update", until it is done', async () => {
  const devices = [created('relay', 'r1'), created('relay', 'r2'), created('relay', 'r4')];
  const { app, gladys, start, wait } = await setup({ devices });
  await start();
  assert.match(message(gladys), /10 relays read only/);
  assert.doesNotMatch(message(gladys), /Update/);

  // cce66's case: R1, R2 listed (R2 as a light), R3 listed but never created.
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1, R2:light, R3' });
  await wait(SECOND);
  assert.doesNotMatch(message(gladys), /read only/);
  assert.match(
    message(gladys),
    /Relays listed, waiting for "Update" in Discover to be driven: R1, R2\./,
  );
  assert.match(
    message(gladys, 'fr'),
    /Relais listés, en attente de « Mettre à jour » dans Découverte pour être pilotés : R1, R2\./,
  );
  // Discovery offers the new feature next to the old one (kept).
  assert.deepEqual(
    discovered(gladys, 'r1')
      .features.map((f) => f.external_id)
      .sort(),
    [F('relay', 'r1', 'readonly'), F('relay', 'r1', 'switch')],
  );

  // The user clicks "Update" on R1: Gladys sends the device updated.
  await gladys.fake.deviceUpdated(discovered(gladys, 'r1'));
  assert.match(message(gladys), /waiting for "Update" in Discover to be driven: R2\./);
  await gladys.fake.deviceUpdated(discovered(gladys, 'r2'));
  assert.doesNotMatch(message(gladys), /Update/);

  // Deleting a relay device takes it out of the reckoning as well (nothing to update).
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1, R2:light, R4' });
  await wait(SECOND);
  assert.match(message(gladys), /waiting for "Update" in Discover to be driven: R4\./);
  await gladys.fake.deviceDeleted(devices[2]);
  assert.doesNotMatch(message(gladys), /Update/);
  app.stop();
});

test('one relay read only: said in the singular, still with the caution', () => {
  const one = T.relaysReadOnly(1);
  assert.match(
    one.en,
    /^1 relay read only: list it in .* only if Gladys must drive it \(never a pump/,
  );
  assert.match(
    one.fr,
    /^1 relais en lecture seule : listez-le dans .* seulement si Gladys doit le piloter \(jamais une pompe/,
  );
});

test('a relay listed after its creation and updated: its feature names stay right in both states', async () => {
  const before = created('relay', 'r1');
  const { app, gladys, start, wait } = await setup({ devices: [before] });
  await start();
  assert.deepEqual(
    before.features.map((f) => f.name),
    ['État (lecture seule)'],
    'the name it is created with',
  );
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  await wait(SECOND);
  await gladys.fake.deviceUpdated(discovered(gladys, 'r1'));
  const r1 = gladys.devices.find((d) => d.external_id === 'ext:rt2:relay:r1');
  const names = r1.features.map((f) => `${f.name} ${f.read_only ? 'ro' : 'rw'}`).sort();
  assert.deepEqual(names, ['Interrupteur rw', 'État (lecture seule) ro']);
  for (const f of r1.features) assert.doesNotMatch(f.name, /voir|see|pilotables/);
  assert.doesNotMatch(message(gladys), /read only|Update/);
  app.stop();
});

test("a relay listed before its creation arrives as a switch only (the guide's order)", async () => {
  const { app, gladys, start } = await setup({
    config: { ...CONFIG, relays: 'R1' },
  });
  await start();
  const r1 = discovered(gladys, 'r1');
  assert.deepEqual(
    r1.features.map((f) => [f.name, f.read_only]),
    [['Interrupteur', false]],
  );
  await gladys.fake.deviceCreated(r1);
  assert.doesNotMatch(message(gladys), /Update/);
  app.stop();
});

test('a relay updated in Discovery is drivable: its switch works', async () => {
  const before = created('relay', 'r1');
  const { app, gladys, start, wait, cmd, world } = await setup({
    devices: [before],
  });
  await start();
  await gladys.fake.configUpdated({ ...CONFIG, relays: 'R1' });
  await wait(SECOND);
  const updated = discovered(gladys, 'r1');
  await gladys.fake.deviceUpdated(updated);
  const ack = await cmd(updated, F('relay', 'r1', 'switch'), 1);
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.equal(world.R[1], 1);
  app.stop();
});

test('the status is not rewritten by a device event during a failure', async () => {
  const devices = [created('relay', 'r1')];
  const world = fakeRt2();
  const { app, gladys, start, wait } = await setup({
    world,
    config: { ...CONFIG, relays: 'R1' },
    devices,
  });
  await start();
  assert.match(message(gladys), /waiting for "Update"/);
  world.failReads = 500;
  await wait(15 * SECOND);
  assert.match(message(gladys), /does not answer/);
  await gladys.fake.deviceUpdated({ ...devices[0] });
  assert.match(message(gladys), /does not answer/);
  app.stop();
});

test('M24: a device event before the first read never shows "Connected"', async () => {
  const world = fakeRt2();
  world.latency = 4000;
  const device = created('relay', 'r1');
  const { app, gladys, act, wait } = await setup({
    world,
    config: { ...CONFIG, relays: 'R1' },
    devices: [device],
  });
  const starting = app.connected({ ...CONFIG, relays: 'R1' });
  await settle();
  assert.doesNotMatch(message(gladys), /Connected/);
  await gladys.fake.deviceUpdated(device);
  await gladys.fake.deviceDeleted(device);
  assert.doesNotMatch(message(gladys), /Connected/, 'nothing read yet');
  world.latency = 20;
  await act(starting);
  await wait(30 * SECOND);
  await gladys.fake.deviceUpdated(device);
  assert.match(message(gladys), /Connected/, 'once read, the status is redone');
  app.stop();
});
