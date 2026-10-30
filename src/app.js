// -----------------------------------------------------------------------------
// One Eco-Devices RT2 of the configuration (a slot: src/hub.js runs up to
// three), read every poll interval through its local JSON API; one Gladys
// device per relay, digital input, pilot-wire zone, X-THL and index; the
// commands; the "Test the connection" and "Accept the held index" buttons.
// index.js only wires the SDK handlers. No command goes to, and no value
// comes from, an Eco-Devices other than the one the devices of the slot
// belong to (see "Identity" below).
//
// Taken from gladys-ipx800 0.1.3 (same author, reviewed in four rounds and on
// a real IPX800 V4 and V5), its IPX800 V4 part: the RT2 speaks the same JSON
// API family. Changed: the reads (several groups, the relays first), the
// identity (no MAC in the API), the product check, and the indexes with
// their guard (src/guard.js, from gladys-ecodevices).
//
// One round: `Get=R` (the relays: the round fails without it), then `Get=D`,
// `Get=FP` (when zones are listed), `Get=XTHL` (when an X-THL is listed) and
// `Index=all`. A secondary group that fails leaves its targets known without
// value (never 0), said in the status; it never stops the round.
//
// The pace is kept across restarts: never two rounds less than an interval
// apart, whatever asks (a reconnection, a save of the form, the test button,
// the Discover tab, a restart: the time of the last attempt is kept in /data
// before the read). A failed round pauses 10 s, 30 s, 1, 2 then 5 min (a
// minute at least when the Eco-Devices asks to wait), the pause kept in
// /data. A refused API key stops the reads until the key changes or the test
// button succeeds. A configuration of Gladys that cannot be read is read
// again (5 s, 15 s, then every minute), at every connection to Gladys, and
// at once (2 s apart at most) when a command comes before it. The
// configurations apply one at a time, in order, the last one winning.
//
// Two clocks: `now` (wall clock) dates what /data keeps; `monotonic` paces
// the reads, the pauses, the deadlines and the publication budget. The clock
// is read once per decision (`dueAt(mono)` computes on the caller's instant).
// The index guards date their values on the session clock: the wall clock at
// the start of the session plus the monotonic time since (a jump of the wall
// clock never widens nor shrinks their margin).
//
// Commands (one lane of requests, see src/rt2/client.js):
//   - protective: pilot wire Off and Frost protection, a listed relay
//     switched off. Never refused by the heating option, a pause, a refused
//     key, the queue, a read, a read back or a command in progress, nor
//     before the first read (the targets come from the configuration).
//     Clicked, they cut any request in flight but another clicked one,
//     cancel the commands of the same target still waiting, are tried again
//     for 250 ms, then kept (a guard, in /data) and sent again as soon as the
//     lane is free, and by the reads that contradict them (3 times at most).
//     Clicked before the configuration is read, they ask for it at once and
//     are kept in memory until it comes. A guard is lifted by a later
//     command on the target that left (a click), by another protective
//     command, by the relay leaving the list, or once confirmed, by another
//     value read twice in a row (changed on the Eco-Devices itself, not an
//     older command of ours handled late); never by the time.
//   - the others (a declared relay switched on, the heating modes Eco and
//     Comfort behind `allow_heating_modes`): a bounded queue served one at a
//     time; the option, the declaration and the deadline checked on arrival
//     and again right before the request leaves; a heating mode needs /data
//     written first.
//   - written within 3.5 s of the click or refused "nothing was sent";
//     confirmed by a read back that left after the write (shared by the
//     commands of a scene); a read back equal to the state before is "not
//     applied yet"; a write that may have left is never "not sent".
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig, sessionKey } from './config.js';
import {
  FEATURES as F,
  FP_CODE,
  GUARD_LIMITS,
  KINDS,
  LIMITS,
  LIMITS_RT2,
  PROTECTIVE_MODES,
  READS,
  TIMINGS,
} from './constants.js';
import { buildDevice, idsOf, parseExternalId, targetStates } from './devices.js';
import { IndexGuard } from './guard.js';
import { ERRORS, T, age, both, describe, join, listOf, reasonOf, shownCode, word } from './i18n.js';
import { PRIORITY, Rt2Client } from './rt2/client.js';
import { Rt2Error, errorReason } from './rt2/http.js';
import {
  checkEnvelope,
  fixedCodes,
  indexKey,
  kindOf,
  meterOf,
  numberOf,
  valueOf,
  writeQuery,
} from './rt2/model.js';
import { StatePublisher } from './publisher.js';
import { emptyMemory, fileStore, normalizeMemory } from './store.js';

/**
 * The tag of a refused API key: 8 bits of a salted hash, never more (the key
 * must not be found back from /data). Two keys share it once in 256: the
 * test button then tries anyway.
 */
export const tagOf = (salt, key) =>
  createHash('sha256').update(`${salt}\u0000${key}`, 'utf8').digest()[0];

/** A command value from Gladys: an integer (or its plain text); undefined otherwise. */
function integerOf(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  if (typeof value === 'string' && /^\d{1,2}$/.test(value)) return Number(value);
  return undefined;
}

/** Is this command protective (never refused, sent first)? */
export const isProtective = (kind, value) =>
  (kind === KINDS.PILOT && PROTECTIVE_MODES.includes(value)) ||
  (kind === KINDS.RELAY && value === 0);

/** The group read back after a command on a kind. */
const groupOf = (kind) => (kind === KINDS.RELAY ? READS.RELAYS : READS.PILOT);

/** The id of a Gladys device kept with the state of its index (a new device starts afresh). */
const deviceKeyOf = (device) =>
  typeof device?.id === 'string' && device.id !== ''
    ? device.id.slice(0, 64)
    : typeof device?.created_at === 'string'
      ? device.created_at.slice(0, 64)
      : undefined;

/** The value Gladys holds for a feature: `{ value, at }` (wall ms), when known. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/** The errors of a secondary group after which the round goes on (its targets unread). */
const STOPPING = ['cut', 'busy'];

export class Rt2App {
  constructor({
    gladys,
    logger = createLogger({ name: 'ecodevices-rt2' }),
    transport,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = globalThis,
    store = fileStore(),
    random = () => randomBytes(16).toString('hex'),
    slot = 1,
    publisher,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.transport = transport;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.random = random;
    /** Which Eco-Devices of the configuration (1 to SLOTS): its ids and its /data file. */
    this.slot = slot;
    // The budget of 300 states a minute counts on the monotonic clock; shared by the slots
    // when given (src/hub.js starts and stops it then).
    this.ownPublisher = !publisher;
    this.publisher = publisher ?? new StatePublisher({ gladys, logger, now: monotonic, timers });
    /**
     * Is the Eco-Devices read the one the devices of this slot were made for (the owner in
     * /data, its address and port)? 'same'; 'different' (another address: nothing sent, its
     * kept Offs dropped); 'unbound' (devices whose Eco-Devices is not known: nothing sent).
     */
    this.verdict = 'unbound';
    /** The first click of "Attach the devices": { at, id }. */
    this.attachAsk = undefined;
    /** The `product` another GCE device answers at the address (not an Eco-Devices RT2). */
    this.wrongProduct = undefined;
    this.config = normalizeConfig();
    this.configLoaded = false;
    this.configTries = 0;
    this.configTimer = undefined;
    this.configGeneration = 0;
    this.memory = emptyMemory();
    this.storeUnreadable = false;
    this.saveFailed = false;
    this.client = undefined;
    this.generation = 0;
    this.started = false;
    /** The session clock: the wall clock at the start and the monotonic time then. */
    this.session = { wall: this.now(), mono: this.monotonic() };
    /** code -> target (with `value` and `at`, the monotonic time its read left). */
    this.model = new Map();
    this.round = undefined;
    this.lastReadAt = undefined;
    this.pause = undefined;
    this.failures = 0;
    this.offline = false;
    this.lastReason = undefined;
    /**
     * code -> guard of a protective command: { code, kind, value, resends, confirmed, other,
     * seq, sentAt, inFlight, stale }. `stale`: an older write of ours on the target that had
     * left without an answer when the guard came (it may still land after it).
     */
    this.guards = new Map();
    /** code -> the last write that left: { value, sentAt, answered } (memory only). */
    this.lastWrites = new Map();
    this.seq = 0;
    /** code -> true: a command the read back contradicts, until a read shows it. */
    this.warnings = new Map();
    /** code -> { expected, at }: a command not yet seen in a read. */
    this.pendingWrites = new Map();
    this.commands = [];
    this.serving = undefined;
    /** group -> the read back shared by the commands of that group. */
    this.readBackJobs = new Map();
    this.timer = undefined;
    this.followUps = new Set();
    this.running = undefined;
    this.lastStatus = undefined;
    this.published = undefined;
    this.lastTestAt = -Infinity;
    /** The configurations, applied one at a time (the last one queued wins). */
    this.lifecycle = Promise.resolve();
    this.configSeq = 0;
    /** True once a start ended (client created, or nothing to start): commands wait for it. */
    this.ready = false;
    this.readyWaiters = new Set();
    this.lastConfigAsk = -Infinity;
    this.configLoading = undefined;
    /** code -> { kind, value }: protective commands clicked before the configuration was read. */
    this.pendingProtectives = new Map();
    /** Codes of protective commands kept for the configuration, then unknown or not listed. */
    this.droppedPending = new Set();
    this.memoryLoaded = false;
    /** code -> IndexGuard of a meter with a created device. */
    this.meterGuards = new Map();
    /** code -> { device, feature } the guard belongs to. */
    this.meterMeta = new Map();
    /** code -> the held value last logged (a hold is logged once). */
    this.heldLogged = new Map();
    /** The first click of "Accept the held index": { at, listedAt, list, generation }. */
    this.pendingAccept = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Connected to Gladys (each time): the configuration is read (`load`, the
   * SDK's getConfig), and read again on failure (5 s, 15 s, then every
   * minute) with a status saying so.
   */
  async onConnected(load) {
    this.configLoader = load;
    this.configTries = 0;
    this.clearConfigTimer();
    await this.loadConfig();
  }

  loadConfig() {
    if (!this.configLoading) {
      this.configLoading = this.loadConfigNow().finally(() => {
        this.configLoading = undefined;
      });
    }
    return this.configLoading;
  }

  /** A command came before the configuration: read it now, or 2 s after the last read at most. */
  askConfig() {
    if (!this.configLoader || this.configLoading) {
      return;
    }
    const wait = Math.max(0, this.lastConfigAsk + TIMINGS.configAskGap - this.monotonic());
    this.clearConfigTimer();
    this.configTimer = this.timers.setTimeout(() => {
      this.configTimer = undefined;
      return this.loadConfig().catch(() => {});
    }, wait);
  }

  async loadConfigNow() {
    const generation = ++this.configGeneration;
    this.lastConfigAsk = this.monotonic();
    let raw;
    try {
      raw = await this.configLoader();
    } catch (err) {
      if (generation !== this.configGeneration) {
        return;
      }
      // A protective command waits for it: the shortest retry, whatever failed before.
      const wait =
        this.pendingProtectives.size > 0
          ? TIMINGS.configRetry[0]
          : TIMINGS.configRetry[Math.min(this.configTries, TIMINGS.configRetry.length - 1)];
      this.configTries += 1;
      this.logger.warn(
        `ecodevices-rt2: configuration not read (${err?.name ?? 'Error'}); new try in ${Math.round(wait / 1000)} s`,
      );
      this.clearConfigTimer();
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        return this.loadConfig().catch(() => {});
      }, wait);
      // Not awaited: a slow Gladys never delays the next read of the configuration.
      this.setStatus(false, T.configNotRead(age(wait))).catch(() => {});
      return;
    }
    if (generation !== this.configGeneration) {
      return;
    }
    this.configTries = 0;
    await this.connected(raw);
  }

  clearConfigTimer() {
    if (this.configTimer !== undefined) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
  }

  /**
   * The configuration of Gladys read. The first time, start; after a
   * reconnection (Gladys restarted), apply it and resend what Gladys keeps in
   * memory only (the status, the Discovery list); the values follow at the
   * next read, never the old ones.
   */
  connected(raw = {}) {
    return this.enqueue(raw, true);
  }

  /** A configuration saved by the user. */
  configUpdated(raw = {}) {
    return this.enqueue(raw, false);
  }

  /**
   * One configuration at a time, in order: a configuration superseded by a
   * newer one still waiting is skipped (the last one wins); a reconnection
   * still resends what Gladys keeps in memory only.
   */
  enqueue(raw, reconnection) {
    const seq = ++this.configSeq;
    const job = async () => {
      if (seq === this.configSeq) {
        if (reconnection) await this.connectedNow(raw);
        else await this.configUpdatedNow(raw);
      } else if (reconnection && this.started) {
        await this.resendToGladys();
      }
    };
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch((err) =>
      this.logger.error(`ecodevices-rt2: configuration not applied (${err?.name ?? 'Error'})`),
    );
    return this.lifecycle;
  }

  async connectedNow(raw = {}) {
    if (!this.started || !this.configLoaded) {
      this.configLoaded = true;
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdatedNow(raw);
    await this.resendToGladys();
  }

  /** Gladys restarted: the status and the Discovery list again; the values at the next read. */
  async resendToGladys() {
    this.published = undefined;
    this.gladys.forgetPublishedStates?.();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
  }

  async start(raw = {}) {
    try {
      await this.startNow(raw);
    } catch (err) {
      // Never left without a timer, whatever failed.
      this.logger.error(`ecodevices-rt2: start failed (${err?.name ?? 'Error'})`);
      this.failures += 1;
      this.setPause(this.monotonic(), TIMINGS.backoff[0], 'failed');
      this.schedule();
    } finally {
      this.setReady();
    }
  }

  setReady() {
    this.ready = true;
    for (const resolve of this.readyWaiters) resolve(true);
    this.readyWaiters.clear();
  }

  /** Resolves true once a start ended, false at `deadline` (monotonic). */
  waitReady(deadline) {
    if (this.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok) => {
        this.timers.clearTimeout(timer);
        this.readyWaiters.delete(done);
        resolve(ok);
      };
      const timer = this.timers.setTimeout(
        () => done(false),
        Math.max(0, deadline - this.monotonic()),
      );
      this.readyWaiters.add(done);
    });
  }

  async startNow(raw = {}) {
    this.ready = false;
    // Nothing goes to /data until this start has read it back.
    this.memoryLoaded = false;
    this.stop();
    const generation = this.generation;
    await this.running?.catch(() => {});
    this.config = normalizeConfig(raw);
    this.configLoaded = true;
    this.reset();
    const now = this.now();
    const mono = this.monotonic();
    this.session = { wall: now, mono };
    let loaded = null;
    this.storeUnreadable = false;
    try {
      loaded = await this.store.load();
    } catch (err) {
      // Not the same as empty: nothing is written over it until it reads again.
      this.storeUnreadable = true;
      this.logger.warn(`ecodevices-rt2: /data unreadable (${err?.code ?? 'error'})`);
    }
    if (generation !== this.generation) return;
    this.adoptMemory(normalizeMemory(loaded, now), now, mono);
    this.memoryLoaded = true;
    // The index guards of the created devices from /data: a value held stays held (and listed).
    for (const [code, saved] of Object.entries(this.memory.meters)) {
      this.meterGuard(code, saved.feature);
    }
    if (!this.memory.salt && !this.storeUnreadable) this.memory.salt = this.random();
    if (this.ownPublisher) this.publisher.start();
    const missing = this.configMessage();
    if (missing) {
      this.verdict = 'unbound';
      await this.setStatus(false, missing);
      // Nothing read: the Discover list of the previous configuration goes.
      await this.publishDevices();
      return;
    }
    // Which Eco-Devices the devices of this slot belong to, before anything is sent: from
    // /data and the configuration (its address and port).
    this.verdict = this.verdictAtStart();
    if (this.verdict === 'different') this.dropGuards('another Eco-Devices is configured');
    this.client = new Rt2Client({
      host: this.config.host,
      port: this.config.port,
      apiKey: this.config.apiKey,
      transport: this.transport,
      monotonic: this.monotonic,
      timers: this.timers,
    });
    // The key is known: before any call to Gladys, the protective commands leave. Those
    // clicked before the configuration was read, then those kept in /data and not seen
    // applied (after a restart or a new configuration), before the first read. The clicks
    // first, at their priority: no guard of /data starts before them only to be cut.
    const clicked = new Set(this.adoptPendingProtectives());
    const kept = [...this.guards.values()].filter((guard) => !clicked.has(guard));
    for (const guard of [...clicked, ...kept]) {
      if (clicked.has(guard)) {
        this.resendGuard(guard, PRIORITY.PROTECTIVE);
      } else if (!guard.confirmed && guard.resends < TIMINGS.resendMax) {
        this.resendGuard(guard);
      }
    }
    // Commands (a click waiting) may go from now on.
    this.setReady();
    await this.saveMemory();
    if (generation !== this.generation) return;
    if (this.refusedApplies()) {
      await this.setStatus(false, T.refused);
    } else if (this.verdict === 'different' || this.verdict === 'unbound') {
      // Known before any read: said at once, not at the next round.
      await this.setStatus(false, this.statusMessage());
    } else {
      await this.setStatus(false, this.pause ? this.pauseMessage(mono) : T.connecting);
    }
    await this.publishDevices();
    if (generation !== this.generation) return;
    this.schedule();
    // The first round now when it is due; not awaited (a slow Eco-Devices never holds the start).
    this.tick();
  }

  /** What /data holds, for this controller only. */
  adoptMemory(saved, now, mono) {
    if (saved.lastAttemptAt !== null) {
      // Whatever the controller: never two reads within an interval.
      this.lastReadAt = mono - (now - saved.lastAttemptAt);
    }
    if (saved.key !== this.config.key) {
      // Another controller: its pause, refusal and guards are not this one's.
      saved.key = this.config.key;
      saved.pause = null;
      saved.refused = null;
      saved.guards = [];
    }
    this.memory = saved;
    if (saved.foreign && saved.foreign.key === this.config.key) {
      // Another GCE product answered at this address last time: nothing is sent before a round
      // reads an Eco-Devices RT2 there.
      this.wrongProduct = saved.foreign.product;
    }
    if (saved.pause && saved.pause.until > now) {
      this.pause = {
        due: mono + (saved.pause.until - now),
        failures: saved.pause.failures,
        code: saved.pause.code,
      };
      this.failures = saved.pause.failures;
    }
    // The relays, inputs and extensions come from the configuration: a command can leave
    // before the first read.
    for (const code of fixedCodes(this.config.extensions)) {
      const kind = kindOf(code);
      if (kind) {
        this.model.set(code, { code, kind, n: numberOf(code), value: undefined, at: undefined });
      }
    }
    for (const g of saved.guards) {
      this.guards.set(g.code, this.makeGuard(g, mono));
    }
    // A relay no longer listed is never driven again, not even by a guard kept in /data.
    this.dropUnlistedGuards();
  }

  /** Drops the guards of the relays not listed now (and of zones not listed); true when one was. */
  dropUnlistedGuards() {
    let dropped = false;
    for (const [code, guard] of this.guards) {
      if (
        (guard.kind === KINDS.RELAY && !this.config.relays.has(code)) ||
        (guard.kind === KINDS.PILOT && !this.config.extensions.has(code))
      ) {
        this.guards.delete(code);
        dropped = true;
        this.logger.info(`ecodevices-rt2: ${shownCode(code)} no longer listed: not held any more`);
      }
    }
    return dropped;
  }

  /** The protective commands clicked before the configuration was read become guards. */
  adoptPendingProtectives() {
    const adopted = [];
    for (const [code, { kind, value, waiting }] of this.pendingProtectives) {
      // A click still waiting sends it itself.
      if (waiting) continue;
      this.pendingProtectives.delete(code);
      const target = this.model.get(code);
      const unlisted = kind === KINDS.RELAY && !this.config.relays.has(code);
      const other = !this.mayDrive(true);
      if (!target || target.kind !== kind || unlisted || other) {
        // Told, never dropped silently: the ack said it would be sent.
        this.droppedPending.add(code);
        this.logger.warn(
          `ecodevices-rt2: ${shownCode(code)} clicked before the configuration: not sent (${other ? 'not the Eco-Devices of the devices' : unlisted ? 'relay not listed' : 'unknown on this Eco-Devices'})`,
        );
        continue;
      }
      this.seq += 1;
      const guard = this.makeGuard({ code, kind, value, seq: this.seq });
      this.guards.set(code, guard);
      adopted.push(guard);
      this.logger.info(
        `ecodevices-rt2: ${shownCode(code)} clicked before the configuration: sent now`,
      );
    }
    return adopted;
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    for (const timer of this.followUps) {
      this.timers.clearTimeout(timer);
    }
    this.followUps.clear();
    if (this.ownPublisher) this.publisher.stop();
    for (const job of this.commands.splice(0)) {
      job.reject(
        this.refusal(ERRORS.notSent(both('integration restarting', 'intégration en redémarrage'))),
      );
    }
    this.client?.close();
    this.client = undefined;
  }

  /** The container stops: every timer, /data written. */
  async shutdown() {
    this.configGeneration += 1;
    this.clearConfigTimer();
    this.stop();
    await this.saveMemory();
  }

  clearTimer() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  reset() {
    this.droppedPending.clear();
    this.model.clear();
    this.round = undefined;
    this.pause = undefined;
    this.failures = 0;
    this.offline = false;
    this.lastReason = undefined;
    this.guards.clear();
    this.warnings.clear();
    this.pendingWrites.clear();
    this.published = undefined;
    this.lastStatus = undefined;
    this.attachAsk = undefined;
    this.wrongProduct = undefined;
    this.meterGuards.clear();
    this.meterMeta.clear();
    this.heldLogged.clear();
    this.pendingAccept = undefined;
  }

  configMessage() {
    if (this.config.addressError === 'path') return T.addressPath;
    if (this.config.addressError === 'https') return T.addressHttps;
    if (this.config.addressError === 'invalid') return T.addressInvalid;
    if (this.config.apiKeyInvalid) return T.apiKeyInvalid;
    return isComplete(this.config) ? undefined : T.noConfig;
  }

  /** A new controller or key: start again; the rest applies at once. */
  async configUpdatedNow(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    this.clearConfigTimer();
    if (!this.started || !this.configLoaded || sessionKey(next) !== sessionKey(previous)) {
      this.started = true;
      this.configLoaded = true;
      return this.start(raw);
    }
    this.config = next;
    // The extensions listed now: a zone or an X-THL removed is no longer a target.
    for (const [code, target] of [...this.model]) {
      if ((target.kind === KINDS.PILOT || target.kind === KINDS.THL) && !next.extensions.has(code))
        this.model.delete(code);
    }
    for (const code of next.extensions) {
      if (!this.model.has(code)) {
        this.model.set(code, {
          code,
          kind: kindOf(code),
          n: numberOf(code),
          value: undefined,
          at: undefined,
        });
      }
    }
    // A counter given another type or unit: its guard starts again from Gladys and /data.
    if (JSON.stringify([...next.counters]) !== JSON.stringify([...previous.counters])) {
      for (const code of [...this.meterGuards.keys()]) {
        if (code.startsWith('c')) this.forgetMeter(code);
      }
    }
    if (this.dropUnlistedGuards()) {
      await this.saveMemory();
    }
    if (next.allowHeatingModes !== previous.allowHeatingModes) {
      this.logger.info(
        `ecodevices-rt2: heating modes ${next.allowHeatingModes ? 'allowed' : 'off'}`,
      );
    }
    if (next.pollInterval !== previous.pollInterval) {
      this.schedule();
    }
    this.published = undefined;
    await this.publishDevices();
    if (this.round && !this.offline && !this.refusedApplies()) {
      await this.setStatus(this.statusConnected(), this.statusMessage());
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  // --- /data -------------------------------------------------------------------

  /** The guards, the index states and the pause into the memory written to /data. */
  syncMemory(mono = this.monotonic()) {
    const now = this.now();
    this.memory.key = this.config.key;
    this.memory.pause = this.pause
      ? {
          until: now + Math.max(0, this.pause.due - mono),
          failures: this.failures,
          code: this.pause.code,
        }
      : null;
    this.memory.guards = [...this.guards.values()].slice(0, LIMITS.guards).map((g) => ({
      code: g.code,
      kind: g.kind,
      value: g.value,
      resends: g.resends,
      confirmed: g.confirmed,
      ...(g.other !== undefined ? { other: g.other } : {}),
    }));
    // The index states of the guards built; those of /data not built yet are kept as read.
    const meters = { ...this.memory.meters };
    for (const [code, guard] of this.meterGuards) {
      const meta = this.meterMeta.get(code) ?? {};
      meters[code] = {
        feature: meta.feature,
        ...(meta.device ? { device: meta.device } : {}),
        ...guard.state(),
      };
    }
    this.memory.meters = Object.fromEntries(Object.entries(meters).slice(0, LIMITS.meters));
  }

  /** true when /data was written. A failure is logged once until a save succeeds again. */
  async saveMemory() {
    if (!this.memoryLoaded) {
      // Between the reset of a start and its read of /data: never written over.
      return false;
    }
    if (this.storeUnreadable) {
      // Read again first: what it holds is never overwritten unseen.
      try {
        const loaded = normalizeMemory(await this.store.load(), this.now());
        this.storeUnreadable = false;
        // The owner, its salt and the index states are the file's: none was set meanwhile.
        this.memory.owner = loaded.owner;
        this.memory.salt = loaded.salt || this.memory.salt || this.random();
        this.memory.meters = loaded.meters;
        this.meterGuards.clear();
        this.meterMeta.clear();
        if (loaded.key === this.config.key) {
          for (const g of loaded.guards) {
            if (!this.guards.has(g.code)) {
              this.guards.set(g.code, this.makeGuard(g));
            }
          }
          this.memory.refused ??= loaded.refused;
        }
        this.dropUnlistedGuards();
      } catch {
        return false;
      }
    }
    this.syncMemory();
    try {
      await this.store.save(this.memory);
      if (this.saveFailed) {
        this.saveFailed = false;
        this.logger.info('ecodevices-rt2: /data written again');
      }
      return true;
    } catch (err) {
      if (!this.saveFailed) {
        this.saveFailed = true;
        this.logger.warn(
          `ecodevices-rt2: saving the state to /data failed (${err?.code ?? 'error'})`,
        );
      }
      return false;
    }
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Pace --------------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * 1000;
  }

  /** The rest of the pause (ms), capped at every use; 0 when none. */
  pauseLeft(mono) {
    if (!this.pause) return 0;
    return Math.min(Math.max(0, this.pause.due - mono), TIMINGS.pauseMax);
  }

  /** The monotonic time from which the next round may start, from the caller's instant `mono`. */
  dueAt(mono) {
    const due = this.lastReadAt === undefined ? mono : this.lastReadAt + this.interval;
    return Math.max(due, mono + this.pauseLeft(mono));
  }

  setPause(mono, wait, code) {
    this.pause = { due: mono + Math.min(wait, TIMINGS.pauseMax), failures: this.failures, code };
  }

  pauseMessage(mono) {
    const reason =
      this.lastReason ?? both('earlier reads failed', 'les lectures précédentes ont échoué');
    return T.unreachable(reason, age(this.pauseLeft(mono)));
  }

  /** Whether the API key the Eco-Devices refused is the one configured now. */
  refusedApplies() {
    const r = this.memory.refused;
    return Boolean(r && r.tag === tagOf(r.salt, this.config.apiKey));
  }

  /** The session clock (wall ms) at the monotonic instant `mono`: the dates of the index guards. */
  sessionAt(mono) {
    return this.session.wall + (mono - this.session.mono);
  }

  /** One timer: the next round when it is due; none while the key is refused. */
  schedule() {
    this.clearTimer();
    if (!this.client || this.refusedApplies()) {
      return;
    }
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    const generation = this.generation;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      return generation === this.generation ? this.tick() : undefined;
    }, wait);
  }

  /** One round at a time: a tick during a round joins it. */
  tick({ evenRefused = false } = {}) {
    if (!this.running) {
      const generation = this.generation;
      this.running = this.read({ evenRefused })
        .catch((err) => this.recover(err, generation))
        .finally(() => {
          this.running = undefined;
        });
    }
    return this.running;
  }

  /** An internal error (a bug, never an answer of the Eco-Devices): a pause, and the next round. */
  async recover(err, generation) {
    this.logger.error(
      `ecodevices-rt2: unexpected error (${err?.name ?? 'Error'}: ${err?.message ?? err})`,
    );
    if (generation !== this.generation) return;
    this.failures += 1;
    this.setPause(this.monotonic(), Math.max(this.interval, TIMINGS.backoff[0]), 'failed');
    this.schedule();
  }

  async read({ evenRefused }) {
    const generation = this.generation;
    const client = this.client;
    if (!client || (!evenRefused && this.refusedApplies())) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      this.schedule();
      return;
    }
    const gone = () => generation !== this.generation;
    this.lastReadAt = mono;
    // Kept BEFORE the read: a restart during it never reads again sooner.
    this.memory.lastAttemptAt = this.now();
    await this.saveMemory();
    if (gone()) return;
    let result;
    try {
      result = await this.readRound(client, mono);
    } catch (err) {
      if (gone()) return;
      if (err instanceof Rt2Error && (err.code === 'cut' || (err.code === 'late' && !err.sent))) {
        // Cut by a protective command, or never sent (left the queue behind commands at its
        // deadline): not a failure of the Eco-Devices; the next round at its time.
        this.schedule();
        return;
      }
      await this.failed(err, mono);
      this.schedule();
      return;
    }
    if (gone()) return;
    await this.succeeded(result);
    if (!gone()) this.schedule();
  }

  /** One group read, its envelope checked: the JSON. Throws an Rt2Error. */
  async readGroup(client, query, priority, hooks) {
    const json = await client.read(query, priority, hooks);
    const envelope = checkEnvelope(json);
    if (envelope.error) {
      const err = new Rt2Error(envelope.error, 'not an Eco-Devices RT2 answer', { sent: true });
      if (envelope.product) err.product = envelope.product;
      throw err;
    }
    return json;
  }

  /**
   * One round: `{ targets: Map, unread }`, each target with the monotonic time its group's
   * request left (`at`). Throws an Rt2Error for the whole round (the relays not read).
   */
  async readRound(client, started) {
    const budget = started + TIMINGS.roundBudget;
    const hooks = (stamp) => ({
      deadline: Math.min(this.monotonic() + TIMINGS.requestTimeout, budget),
      onSent: stamp,
    });
    const targets = new Map();
    const unread = [];
    const codes = fixedCodes(this.config.extensions);
    const put = (json, kind, at) => {
      for (const code of codes) {
        if (kindOf(code) !== kind) continue;
        const n = numberOf(code);
        targets.set(code, { code, kind, n, value: json ? valueOf(json, kind, n) : undefined, at });
      }
    };
    // The relays first: the identity of the answer (the product) and the round depend on them.
    let at;
    const relays = await this.readGroup(
      client,
      READS.RELAYS,
      PRIORITY.READ,
      hooks(() => (at = this.monotonic())),
    );
    put(relays, KINDS.RELAY, at);
    const secondary = async (query, kind) => {
      let sentAt;
      try {
        const json = await this.readGroup(
          client,
          query,
          PRIORITY.READ,
          hooks(() => (sentAt = this.monotonic())),
        );
        return { json, at: sentAt };
      } catch (err) {
        if (
          !(err instanceof Rt2Error) ||
          STOPPING.includes(err.code) ||
          (err.code === 'late' && !err.sent)
        ) {
          throw err;
        }
        // A secondary group failing never stops the round: its targets unread (never 0).
        unread.push(kind);
        return { json: undefined, at: sentAt ?? at };
      }
    };
    const inputs = await secondary(READS.INPUTS, 'inputs');
    put(inputs.json, KINDS.INPUT, inputs.at);
    if ([...codes].some((c) => kindOf(c) === KINDS.PILOT)) {
      const zones = await secondary(READS.PILOT, 'zones');
      put(zones.json, KINDS.PILOT, zones.at);
    }
    if ([...codes].some((c) => kindOf(c) === KINDS.THL)) {
      const thl = await secondary(READS.THL, 'thl');
      put(thl.json, KINDS.THL, thl.at);
    }
    const indexes = await secondary(READS.INDEXES, 'indexes');
    for (const target of this.metersOf(indexes.json, indexes.at)) {
      targets.set(target.code, target);
    }
    return { targets, unread };
  }

  /**
   * The meters of an `Index=all` answer: a teleinformation index or a clamp read above 0
   * (the API answers them all, wired or not), a counter of the configuration, and any
   * meter with a device created (unread: no value). `json` undefined: none read this time.
   */
  metersOf(json, at) {
    const created = new Set(
      this.createdDevices()
        .map((d) => this.parseId(d.external_id))
        .filter((p) => p?.kind === KINDS.METER)
        .map((p) => p.code),
    );
    const out = [];
    const codes = [];
    for (let n = 1; n <= LIMITS_RT2.ti; n += 1) codes.push(`ti${n}`);
    for (let n = 1; n <= LIMITS_RT2.tore; n += 1) codes.push(`tore${n}`);
    for (let n = 1; n <= LIMITS_RT2.counters; n += 1) codes.push(`c${n}`);
    for (const code of codes) {
      const counter = code.startsWith('c');
      const raw = json ? Object.getOwnPropertyDescriptor(json, indexKey(code))?.value : undefined;
      const meter = meterOf(code, raw, this.config.counters);
      const wanted = counter
        ? this.config.counters.has(code) || created.has(code)
        : (meter?.value !== undefined && json !== undefined) || created.has(code);
      if (!wanted) continue;
      out.push({
        code,
        kind: KINDS.METER,
        n: numberOf(code),
        feature: meter?.feature,
        value: json ? meter?.value : undefined,
        at,
      });
    }
    return out;
  }

  async succeeded({ targets, unread }) {
    this.pause = undefined;
    this.failures = 0;
    this.offline = false;
    this.lastReason = undefined;
    this.wrongProduct = undefined;
    this.memory.foreign = null;
    if (this.memory.refused) {
      this.memory.refused = null;
      this.logger.info('ecodevices-rt2: the Eco-Devices accepts the API key again');
    }
    this.model = new Map(targets);
    this.round = { unread };
    // Which Eco-Devices answered, against the owner of the devices, before anything is published.
    this.applyVerdict(this.judge());
    for (const at of new Set([...targets.values()].map((t) => t.at))) {
      if (at !== undefined) this.applyRead(at);
    }
    const meterStates = this.meterStates();
    // The index states go to Gladys only once /data holds their guards.
    const saved = await this.saveMemory();
    if (saved) for (const [id, state] of meterStates) this.publisher.push(id, state);
    await this.setStatus(this.statusConnected(), this.statusMessage());
    await this.publishDevices();
    await this.flush();
  }

  /** The round failed: a pause; a refused key stops the reads; another product says so. */
  async failed(err, mono) {
    if (err instanceof Rt2Error && err.code === 'wrong_product') {
      // Not a refused key nor an outage: another GCE device answers at this address. A pause
      // as a failure (the user changes the address), nothing published from it.
      const wait = Math.max(
        this.interval,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.failures += 1;
      this.setPause(mono, wait, 'failed');
      this.offline = true;
      this.wrongProduct = err.product ?? '?';
      // Kept: after a restart, nothing goes to that address before a round reads an RT2 there.
      this.memory.foreign = { key: this.config.key, product: this.wrongProduct };
      this.lastReason = T.wrongProductReason(this.wrongProduct);
      this.logger.warn('ecodevices-rt2: another GCE product answers at this address');
      await this.saveMemory();
      await this.setStatus(false, T.wrongProduct(this.wrongProduct));
      await this.publishDevices();
      return;
    }
    // Another product seen before stays so until a round reads an Eco-Devices RT2 (an outage
    // of that box proves nothing).
    if (err instanceof Rt2Error && err.code === 'refused') {
      const salt = this.random();
      this.memory.refused = { salt, tag: tagOf(salt, this.config.apiKey) };
      this.offline = true;
      this.lastReason = reasonOf(err);
      this.logger.warn(
        'ecodevices-rt2: the Eco-Devices refused the API key; no read until it changes',
      );
      await this.saveMemory();
      await this.setStatus(false, T.refused);
      await this.publishDevices();
      return;
    }
    const busy = err instanceof Rt2Error && err.code === 'busy';
    const wait = Math.max(
      this.interval,
      busy ? TIMINGS.busyPause : 0,
      TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
    );
    this.failures += 1;
    this.setPause(mono, wait, busy ? 'busy' : 'failed');
    this.offline = true;
    this.lastReason = reasonOf(err);
    this.logger.warn(
      `ecodevices-rt2: ${errorReason(err)}; next try in ${Math.round(wait / 1000)} s`,
    );
    await this.saveMemory();
    await this.setStatus(false, T.unreachable(this.lastReason, age(wait)));
    // An Eco-Devices that does not answer: its devices leave the Discover list until it does.
    await this.publishDevices();
  }

  /** Connected for Gladys, and its values published onto the devices: the Eco-Devices of the devices. */
  statusConnected() {
    return this.verdict === 'same';
  }

  /** The counts and the warnings of the last round. */
  statusMessage() {
    if (this.verdict === 'different' || this.verdict === 'unbound') {
      return join(
        this.verdictMessage(),
        this.saveFailed || this.storeUnreadable ? T.storeProblem : undefined,
      );
    }
    const counts = { relays: 0, inputs: 0, zones: 0, thl: 0, meters: 0 };
    for (const target of this.model.values()) {
      if (target.kind === KINDS.RELAY) counts.relays += 1;
      else if (target.kind === KINDS.INPUT) counts.inputs += 1;
      else if (target.kind === KINDS.PILOT) counts.zones += 1;
      else if (target.kind === KINDS.THL) counts.thl += 1;
      else if (target.at !== undefined) counts.meters += 1;
    }
    const parts = [T.connected(counts), ...this.relayHints()];
    if (this.config.relayErrors.length > 0) {
      parts.push(T.relayErrors(listOf(this.config.relayErrors)));
    }
    if (this.config.extensionErrors.length > 0) {
      parts.push(T.extensionErrors(listOf(this.config.extensionErrors)));
    }
    if (this.config.counterErrors.length > 0) {
      parts.push(T.counterErrors(listOf(this.config.counterErrors)));
    }
    if (this.round?.unread.length > 0) {
      parts.push(T.groupsUnread(this.round.unread));
    }
    const pending = [...this.guards.values()].filter((g) => !g.confirmed);
    const failing = pending
      .filter((g) => g.resends >= TIMINGS.resendMax)
      .map((g) => shownCode(g.code));
    const resent = pending
      .filter((g) => g.resends < TIMINGS.resendMax)
      .map((g) => shownCode(g.code));
    if (resent.length > 0) parts.push(T.guardsPending(listOf(resent)));
    if (failing.length > 0) parts.push(T.guardsFailed(listOf(failing)));
    if (this.warnings.size > 0) {
      parts.push(T.notApplied(listOf([...this.warnings.keys()].map(shownCode))));
    }
    if (this.droppedPending.size > 0) {
      parts.push(T.pendingDropped(listOf([...this.droppedPending].map(shownCode))));
    }
    const held = this.heldList();
    if (held.length > 0) parts.push(T.held(held));
    if (this.saveFailed || this.storeUnreadable) parts.push(T.storeProblem);
    return join(...parts);
  }

  /**
   * What the user must do for the relays to be driven: none listed (all read
   * only, the default), or a relay listed whose device, created in Gladys
   * before, still lacks the feature of its kind (Gladys adds it only on
   * "Update" in Discovery). Both read from what the SDK knows (the
   * configuration and `gladys.devices`), nothing guessed.
   */
  relayHints() {
    const relays = [...this.model.values()].filter((t) => t.kind === KINDS.RELAY);
    const listed = relays.filter((t) => this.config.relays.has(t.code));
    const hints = [];
    if (relays.length > 0 && listed.length === 0) {
      hints.push(T.relaysReadOnly(relays.length));
    }
    const created = new Map(this.createdDevices().map((d) => [d.external_id, d]));
    const waiting = listed.filter((t) => {
      const ids = idsOf(this.gladys, t.kind, t.code);
      const device = created.get(ids.device);
      const feature = ids.feature(this.config.relays.get(t.code));
      return (
        device !== undefined && !(device.features ?? []).some((f) => f?.external_id === feature)
      );
    });
    if (waiting.length > 0) {
      hints.push(T.relaysToUpdate(listOf(waiting.map((t) => shownCode(t.code)))));
    }
    return hints;
  }

  async refreshStatus() {
    await this.statusAgain();
    await this.flush();
  }

  // --- What a read changes -----------------------------------------------------------

  /**
   * After a read that left at `at` (a group of a round or a read back): the
   * states, the commands checked against it, the guards checked against it
   * (only reads that left after the guard's last send count).
   */
  applyRead(at, { resend = true } = {}) {
    // Another Eco-Devices (or one not known for sure): none of its values reach these devices.
    if (!this.statusConnected()) return;
    const created = this.createdFeatures();
    for (const target of this.model.values()) {
      if (target.at !== at || target.kind === KINDS.METER) continue;
      this.queueStates(target, created);
      const pending = this.pendingWrites.get(target.code);
      if (pending && at > pending.at && target.value !== undefined) {
        if (target.value === pending.expected) {
          this.warnings.delete(target.code);
        } else {
          this.warnings.set(target.code, true);
          this.logger.warn(
            `ecodevices-rt2: the command on ${shownCode(target.code)} did not take effect`,
          );
        }
        this.pendingWrites.delete(target.code);
      }
      const guard = this.guards.get(target.code);
      if (guard && !guard.inFlight && at > guard.sentAt) {
        this.checkGuard(guard, target.value, resend, at);
      }
    }
  }

  /**
   * A guard (new, or from /data: `seq` 0, never sent by this process). `stale`: a command of
   * ours on its target still unanswered (one this guard cut, say): if the Eco-Devices handles
   * it late, the reads showing it are no change on the Eco-Devices.
   */
  makeGuard(
    {
      code,
      kind,
      value,
      resends = 0,
      confirmed = false,
      other,
      seq = 0,
      inFlight = false,
      userInFlight = false,
    },
    mono,
  ) {
    return {
      code,
      kind,
      value,
      resends,
      confirmed,
      other,
      seq,
      sentAt: -Infinity,
      inFlight,
      userInFlight,
      stale: this.mayLand(code, value, mono),
    };
  }

  /**
   * The last write of ours on `code` if it has another value than `value` and left less than
   * a request time ago: until it is answered, it may still land after a guard of `value`.
   */
  mayLand(code, value, mono = this.monotonic()) {
    const write = this.lastWrites.get(code);
    if (!write || write.value === value) return undefined;
    return mono - write.sentAt < TIMINGS.requestTimeout ? write : undefined;
  }

  /** A guard against a value read (by a read that left at `at`) after its last send. */
  checkGuard(guard, value, resend, at) {
    if (guard.kind === KINDS.RELAY && !this.config.relays.has(guard.code)) {
      this.guards.delete(guard.code);
      return;
    }
    if (value === undefined) {
      // Unknown is never "changed elsewhere".
      return;
    }
    // Answered since: the Eco-Devices handled it before answering, it cannot land any more.
    const stale = guard.stale?.answered ? undefined : guard.stale;
    if (value === guard.value) {
      guard.confirmed = true;
      guard.other = undefined;
      // Read after the time our older write could still land: out of the way for good.
      if (!stale || at > stale.sentAt + TIMINGS.requestTimeout) guard.stale = undefined;
      return;
    }
    if (stale && value === stale.value) {
      // Our own older write (cut by this command, or left without an answer) handled late by
      // the Eco-Devices: the guard is contradicted, never "changed on the Eco-Devices"; as a
      // guard not seen applied, it is sent again below.
      guard.stale = undefined;
      guard.confirmed = false;
      guard.other = undefined;
      this.logger.warn(
        `ecodevices-rt2: ${shownCode(guard.code)} shows an older command of the integration, not a change on the Eco-Devices: still held`,
      );
    }
    if (guard.confirmed) {
      if (guard.other === value) {
        // Another value read twice in a row: changed on the Eco-Devices itself (its page, its
        // programs).
        this.guards.delete(guard.code);
        this.logger.info(
          `ecodevices-rt2: ${shownCode(guard.code)} changed on the Eco-Devices, no longer held`,
        );
        return;
      }
      guard.other = value;
      return;
    }
    if (resend && guard.resends < TIMINGS.resendMax) {
      this.resendGuard(guard);
    }
  }

  /**
   * Sends a guard again (no ack): protective priority, counted when it leaves. Cut by a
   * click before its first byte, it goes again right behind that click (within `deadline`),
   * not at the next read.
   */
  resendGuard(
    guard,
    priority = PRIORITY.GUARD,
    deadline = this.monotonic() + TIMINGS.requestTimeout,
  ) {
    const client = this.client;
    const target = this.targetOf(guard.code);
    if (guard.kind === KINDS.RELAY && !this.config.relays.has(guard.code)) {
      // No longer listed: never driven again.
      this.guards.delete(guard.code);
      this.saveMemory().catch(() => {});
      return;
    }
    if (!client || !target || guard.inFlight || !this.mayDrive(true)) return;
    guard.inFlight = true;
    let again = false;
    this.write(client, target, guard.value, priority, {
      deadline,
      beforeSend: () => {
        // A newer command that left meanwhile (or another protective one): never sent over it.
        if (
          this.guards.get(guard.code) !== guard ||
          (guard.kind === KINDS.RELAY && !this.config.relays.has(guard.code))
        ) {
          throw new Rt2Error('late', 'superseded');
        }
        // Another Eco-Devices found meanwhile: an Off kept for the old one never reaches it.
        if (!this.mayDrive(true)) throw new Rt2Error('late', 'not the Eco-Devices of the devices');
      },
      onSent: () => {
        // Counted once it has left (a try that never left is not a resend).
        guard.resends += 1;
        guard.sentAt = this.monotonic();
      },
    })
      .catch((err) => {
        again = err instanceof Rt2Error && err.code === 'cut' && !err.sent;
        this.logger.warn(
          `ecodevices-rt2: ${shownCode(guard.code)} sent again: ${errorReason(err)}`,
        );
      })
      .finally(() => {
        guard.inFlight = false;
        if (again && this.client === client && this.guards.get(guard.code) === guard) {
          // Nothing left: behind the click that cut it (the same checks before its first byte).
          this.resendGuard(guard, priority, deadline);
          return;
        }
        this.saveMemory().catch(() => {});
      });
    this.logger.info(`ecodevices-rt2: ${shownCode(guard.code)} sent again`);
  }

  // --- Indexes ---------------------------------------------------------------------
  //
  // An index (teleinformation, clamp, counter) is published only through its guard
  // (src/guard.js): never 0, never lower, never a jump without the user's two clicks
  // ("Accept the held index"). The guard of a code exists only once its device is created
  // in Gladys; its state (the last value published, a value held) is kept in /data with the
  // id of that device: a device created again starts afresh.

  /** The guard of a meter with a created device; undefined otherwise. */
  meterGuard(code, feature) {
    const device = this.createdDevices().find((d) => this.parseId(d.external_id)?.code === code);
    if (!device || !feature || this.storeUnreadable) return undefined;
    const featureId = idsOf(this.gladys, KINDS.METER, code).feature(feature);
    if (!(device.features ?? []).some((f) => f?.external_id === featureId)) return undefined;
    const key = deviceKeyOf(device);
    const meta = this.meterMeta.get(code);
    if (meta && (meta.device !== key || meta.feature !== feature)) this.forgetMeter(code);
    if (!this.meterGuards.has(code)) {
      let saved = this.memory.meters[code];
      if (saved && (saved.feature !== feature || (saved.device && key && saved.device !== key))) {
        // Kept for another device or another kind of counter: never this one's reference.
        delete this.memory.meters[code];
        saved = undefined;
      }
      const known = lastValueOf(device, featureId);
      const mono = this.monotonic();
      this.meterGuards.set(
        code,
        new IndexGuard(known, saved, this.sessionAt(mono), GUARD_LIMITS[feature]),
      );
      this.meterMeta.set(code, { device: key, feature });
    }
    return this.meterGuards.get(code);
  }

  /** The index state of a meter forgotten (memory; saved by the caller). */
  forgetMeter(code) {
    this.meterGuards.delete(code);
    this.meterMeta.delete(code);
    this.heldLogged.delete(code);
    delete this.memory.meters[code];
  }

  /**
   * The states of the meters read this round, through their guards: `[featureId, state]`.
   * While a value is held, the last accepted one is sent again (no new date for Gladys).
   */
  meterStates() {
    const out = [];
    if (!this.statusConnected() || this.storeUnreadable) return out;
    for (const target of this.model.values()) {
      if (target.kind !== KINDS.METER || target.at === undefined) continue;
      const guard = this.meterGuard(target.code, target.feature);
      if (!guard) continue;
      const plausible =
        target.value !== undefined && guard.accept(target.value, this.sessionAt(target.at));
      this.logHold(target.code, guard);
      const value = plausible ? target.value : guard.held ? guard.last?.value : undefined;
      if (value === undefined) continue;
      for (const [key, state] of targetStates({ ...target, value }, new Set())) {
        out.push([idsOf(this.gladys, KINDS.METER, target.code).feature(key), state]);
      }
    }
    return out;
  }

  logHold(code, guard) {
    const held = guard.held;
    const key = held ? `${held.direction}:${held.from}` : undefined;
    if (key && this.heldLogged.get(code) !== key) {
      this.logger.warn(
        `ecodevices-rt2: ${shownCode(code)} index ${held.direction === 'down' ? 'drop' : 'jump'} held back`,
      );
    }
    if (key) this.heldLogged.set(code, key);
    else this.heldLogged.delete(code);
  }

  /** The indexes held: `[{ code, direction, from, to, threshold, unit }]`. */
  heldList() {
    const out = [];
    for (const [code, guard] of this.meterGuards) {
      const held = guard.held;
      if (!held) continue;
      const feature = this.meterMeta.get(code)?.feature;
      out.push({
        code,
        direction: held.direction,
        from: held.from,
        to: held.to,
        threshold: held.threshold,
        unit: feature === F.ENERGY ? 'kWh' : 'm³',
      });
    }
    return out;
  }

  /**
   * "Accept the held index", in two clicks (as gladys-ecodevices, approved): the first lists
   * every index held and accepts nothing; the second, 3 s to 5 min later in the same session,
   * accepts exactly what the first listed, each only when its held value still shows the
   * same jump or drop (same starting value, same threshold for a jump, the value shown or
   * what the meter may have measured since). A drop accepted gives Gladys a lower index
   * (nothing counted for it: the core skips a delta below zero); the values rise from there.
   */
  acceptHeld() {
    const list = this.heldList();
    const mono = this.monotonic();
    const now = this.sessionAt(mono);
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (
      !pending ||
      pending.generation !== this.generation ||
      elapsed > TIMINGS.acceptWithin ||
      elapsed < TIMINGS.acceptAfter
    ) {
      if (list.length === 0) return T.accept.nothing;
      this.pendingAccept = { at: mono, listedAt: now, list, generation: this.generation };
      return T.accept.confirm(list);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.meterGuards.get(entry.code);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        (entry.direction === 'up'
          ? held.threshold === entry.threshold &&
            held.to >= entry.to &&
            held.to - entry.to <= margin
          : Math.abs(held.to - entry.to) <= margin);
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
        this.logger.info(
          `ecodevices-rt2: ${shownCode(entry.code)} index ${entry.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
        );
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) return T.accept.nothing;
    // Published at the next read (never a read sooner than the interval).
    return T.accept.done(accepted, changed);
  }

  // --- Identity: the Eco-Devices of the devices ----------------------------------------
  //
  // The API of the Eco-Devices RT2 gives no MAC address with the API key (the status files
  // that hold it need the user or admin password): which Eco-Devices a slot's devices
  // belong to is the owner in /data, its controller key (a hash of the address and the
  // port), set at the first round of a slot without devices. Another address (a box moved
  // to another IP, or another one typed) gets no command, no value published onto these
  // devices, no Off kept for the old one, and an empty Discover list, until the
  // configuration points at it again or the user attaches the devices to it ("Attach the
  // devices", two clicks). Known limit: another Eco-Devices RT2 put at the same address and
  // port is taken for the same one. Another GCE product at the address (its `product`) is
  // never taken for it.

  /** Before any read: from /data and the configuration only. */
  verdictAtStart() {
    const owner = this.memory.owner;
    if (this.storeUnreadable || !owner) return 'unbound';
    return owner.id === this.config.key ? 'same' : 'different';
  }

  /** After a round: the verdict; a slot without devices takes the Eco-Devices read as owner. */
  judge() {
    const owner = this.memory.owner;
    const key = this.config.key;
    // /data unreadable is not empty: no owner is set over it (protective commands only).
    if (this.storeUnreadable) return 'unbound';
    const hasDevices = this.createdDevices().length > 0;
    const bind = (why) => {
      this.memory.owner = { kind: 'address', id: key };
      if (owner) this.dropGuards('owner changed');
      this.logger.info(
        `ecodevices-rt2: devices of Eco-Devices #${this.slot} now belong to the Eco-Devices read (${why})`,
      );
      return 'same';
    };
    if (!owner) return hasDevices ? 'unbound' : bind('first read');
    const verdict = owner.id === key ? 'same' : 'different';
    if (verdict === 'different' && !hasDevices) return bind('no device left');
    return verdict;
  }

  applyVerdict(verdict) {
    if (verdict === 'different' && this.verdict !== 'different') {
      this.logger.warn(
        `ecodevices-rt2: Eco-Devices #${this.slot}: its devices were made at another address; they get nothing`,
      );
    }
    this.verdict = verdict;
    if (verdict === 'different') this.dropGuards('another Eco-Devices');
  }

  /** The Offs kept for the owner never go to another Eco-Devices. */
  dropGuards(why) {
    if (this.guards.size > 0) {
      this.logger.warn(`ecodevices-rt2: ${this.guards.size} Off kept dropped (${why})`);
    }
    this.guards.clear();
    this.pendingWrites.clear();
    this.warnings.clear();
  }

  /**
   * May a command leave for this Eco-Devices? Only to the Eco-Devices of the devices; an Off
   * also while /data cannot be read (its owner unknown: to the address typed).
   */
  mayDrive(protective) {
    // Another GCE product answers at the address (seen by a round, or kept in /data): not the
    // Eco-Devices of the devices, whatever the owner says; nothing goes to it, an Off neither.
    if (this.wrongProduct) return false;
    switch (this.verdict) {
      case 'same':
        return true;
      case 'unbound':
        return protective && this.storeUnreadable;
      default:
        return false;
    }
  }

  verdictError() {
    if (this.wrongProduct) return ERRORS.wrongProduct;
    switch (this.verdict) {
      case 'different':
        return ERRORS.otherBox(this.slot);
      default:
        return this.storeUnreadable ? ERRORS.saveFailed : ERRORS.notAttached(this.slot);
    }
  }

  verdictMessage() {
    if (this.verdict === 'different') return T.otherBox(this.slot);
    if (this.storeUnreadable) return T.ownerUnreadable;
    return T.notAttached(this.slot);
  }

  /**
   * "Attach the devices": the devices of this slot belong from now on to the Eco-Devices
   * read by the last round (at another address, or one not known). Two clicks within a
   * minute on the same address: the relays listed then drive that one. Its kept Offs are
   * dropped.
   */
  async attach() {
    if (!this.client || !this.round || this.offline || this.wrongProduct) {
      return T.attach.notRead;
    }
    if (this.verdict === 'same') return T.attach.already(this.slot);
    if (this.storeUnreadable) return T.storeProblem;
    const mono = this.monotonic();
    const id = this.config.key;
    const count = this.createdDevices().length;
    const ask = this.attachAsk;
    if (!ask || ask.id !== id || mono - ask.at > TIMINGS.attachConfirm) {
      this.attachAsk = { at: mono, id };
      return T.attach.confirm(this.slot, count);
    }
    this.attachAsk = undefined;
    this.memory.owner = { kind: 'address', id };
    this.dropGuards('devices attached to another Eco-Devices');
    this.verdict = 'same';
    this.logger.info(
      `ecodevices-rt2: devices of Eco-Devices #${this.slot} attached to the Eco-Devices read`,
    );
    await this.saveMemory();
    this.published = undefined;
    await this.setStatus(this.statusConnected(), this.statusMessage());
    await this.publishDevices();
    return T.attach.done(this.slot, count);
  }

  // --- Gladys --------------------------------------------------------------------

  /** One of the external ids of this slot: `{ kind, code, key }`; undefined otherwise. */
  parseId(externalId) {
    return parseExternalId(externalId, this.gladys.selector, this.slot);
  }

  createdDevices() {
    return (this.gladys.devices ?? []).filter((d) => this.parseId(d.external_id));
  }

  createdFeatures() {
    return new Map(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => [f.external_id, f])),
    );
  }

  /**
   * The Discover list: the targets of the Eco-Devices really read (a round of this session,
   * no failure since, the Eco-Devices of the devices), the features of the devices created
   * kept. Anything else (not read yet, unreachable, refused key, another Eco-Devices or
   * product) is an empty list: nothing of a box not read stays there.
   */
  async publishDevices() {
    const devices = [];
    if (this.round && !this.offline && this.verdict === 'same' && !this.refusedApplies()) {
      const created = new Map();
      for (const device of this.createdDevices()) created.set(device.external_id, device);
      for (const target of this.model.values()) {
        if (target.at === undefined) continue;
        const ids = idsOf(this.gladys, target.kind, target.code);
        const device = buildDevice(this.gladys, target, {
          language: this.config.language,
          relayKind: this.config.relays.get(target.code),
          created: created.get(ids.device),
          slot: this.slot,
        });
        if (device.features.length > 0) devices.push(device);
      }
    }
    const json = JSON.stringify(devices);
    if (json === this.published) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** Queues the states of a target read, for the features created in Gladys only (no meter). */
  queueStates(target, created = this.createdFeatures()) {
    if (target.kind === KINDS.METER) return;
    const ids = idsOf(this.gladys, target.kind, target.code);
    const keys = new Set(
      [F.READONLY, F.SWITCH, F.LIGHT].filter((key) => created.has(ids.feature(key))),
    );
    for (const [key, state] of targetStates(target, keys)) {
      const id = ids.feature(key);
      if (created.has(id)) this.publisher.push(id, state);
    }
  }

  /**
   * A device created (or updated): its last values at once, only when fresh
   * (read by a round younger than an interval, no failure since). An index waits for the
   * next round (its guard first).
   */
  async deviceCreated(device) {
    const parsed = this.parseId(device?.external_id);
    const target = parsed && this.model.get(parsed.code);
    const mono = this.monotonic();
    if (
      target &&
      target.kind !== KINDS.METER &&
      target.at !== undefined &&
      !this.offline &&
      this.statusConnected() &&
      this.pauseLeft(mono) === 0 &&
      mono - target.at <= this.interval + TIMINGS.roundBudget
    ) {
      const created = this.createdFeatures();
      for (const f of device?.features ?? []) created.set(f.external_id, f);
      this.queueStates(target, created);
      await this.flush();
    }
    // A relay created or updated in Discovery may end a "waiting for Update" in the status.
    if (parsed?.kind === KINDS.RELAY) await this.statusAgain();
  }

  async deviceDeleted(device) {
    if (device?.external_id) this.publisher.forget(device.external_id);
    const parsed = this.parseId(device?.external_id);
    if (!parsed) return;
    if (parsed.kind === KINDS.METER) {
      // Its index state goes with it: a device created again starts afresh.
      this.forgetMeter(parsed.code);
      this.pendingAccept = undefined;
      await this.saveMemory();
    }
    // The list again at once: a device recreated right away gets the features of now (a
    // relay removed from the list no longer gets back the switch of the deleted device).
    await this.publishDevices();
    await this.statusAgain();
  }

  /** The status of the last round again (what Gladys knows changed), never during a failure. */
  async statusAgain() {
    if (this.round && !this.offline && !this.refusedApplies()) {
      await this.setStatus(this.statusConnected(), this.statusMessage());
    }
  }

  /** The Discovery tab asks for a scan: a round now when it is due, else the last list. */
  async scan() {
    if (this.client && !this.running) {
      const mono = this.monotonic();
      if (mono >= this.dueAt(mono) && !this.refusedApplies()) {
        await this.tick();
        return;
      }
    }
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button -------------------------------------------------------

  async testConnection() {
    const missing = this.configMessage();
    if (missing) return missing;
    if (!this.client) return T.connecting;
    const mono = this.monotonic();
    if (mono - this.lastTestAt < TIMINGS.testCooldown) {
      return this.lastMessage ?? T.connecting;
    }
    this.lastTestAt = mono;
    if (this.running) return T.test.busy;
    const due = this.dueAt(mono);
    if (mono < due) {
      return join(T.test.wait(age(due - mono)), this.lastMessage ?? T.connecting);
    }
    let handle;
    const budget = new Promise((resolve) => {
      handle = this.timers.setTimeout(() => resolve('slow'), TIMINGS.testBudget);
    });
    const result = await Promise.race([
      this.tick({ evenRefused: true }).then(() => 'done'),
      budget,
    ]);
    this.timers.clearTimeout(handle);
    if (result === 'slow') return T.test.slow;
    return this.lastMessage ?? T.connecting;
  }

  // --- Commands --------------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  /** The target of a code: from the last round or the configuration. */
  targetOf(code) {
    return this.model.get(code);
  }

  /**
   * One write through the lane; resolves when the Eco-Devices accepted it. What left is kept
   * per target (`lastWrites`): until it is answered, it may land after a newer guard.
   */
  write(client, target, value, priority, hooks) {
    const record = { value, sentAt: undefined, answered: false };
    const tracked = {
      ...hooks,
      onSent: () => {
        record.sentAt = this.monotonic();
        this.lastWrites.set(target.code, record);
        hooks.onSent?.();
      },
    };
    const query = writeQuery(target, value, FP_CODE.get(value));
    if (!query) return Promise.reject(new Rt2Error('bad_request', 'invalid write'));
    const written = client.write(query, priority, tracked);
    written.then(
      () => {
        record.answered = true;
      },
      (err) => {
        // An answer came (a refusal, a status): handled before it, it cannot land later.
        record.answered = !(
          err instanceof Rt2Error && ['cut', 'timeout', 'network'].includes(err.code)
        );
      },
    );
    return written;
  }

  /**
   * A read of a group (`Get=R` or `Get=FP`) that leaves after this call (shared by the
   * commands asking for one before it leaves): `{ values: Map(code -> value), at }`.
   */
  readBack(group, priority, deadline, { resend = false, after = Infinity } = {}) {
    const job = this.readBackJobs.get(group);
    // Shared when it leaves after the caller's write: not left yet (the write is answered), or
    // left after the write left (one request at a time: then after its answer too).
    if (
      job &&
      job.priority <= priority &&
      job.client === this.client &&
      (!job.started || job.sentAt > after)
    ) {
      return job.promise;
    }
    const client = this.client;
    const generation = this.generation;
    const next = { started: false, priority, client, sentAt: undefined };
    const kind = group === READS.RELAYS ? KINDS.RELAY : KINDS.PILOT;
    next.promise = (async () => {
      let at;
      const hooks = {
        deadline,
        onSent: () => {
          next.started = true;
          at = this.monotonic();
          next.sentAt = at;
        },
      };
      const json = await this.readGroup(client, group, priority, hooks);
      const values = new Map();
      for (const [code, target] of this.model) {
        if (target.kind === kind) values.set(code, valueOf(json, kind, target.n));
      }
      if (generation === this.generation) this.storeReadBack(values, at, resend);
      return { values, at };
    })();
    next.promise
      .catch(() => {})
      .finally(() => {
        if (this.readBackJobs.get(group) === next) this.readBackJobs.delete(group);
      });
    this.readBackJobs.set(group, next);
    return next.promise;
  }

  /** The values of a read back into the model (relays or zones), then the checks. */
  storeReadBack(values, at, resend) {
    for (const [code, value] of values) {
      const target = this.model.get(code);
      if (target && value !== undefined) {
        this.model.set(code, { ...target, value, at });
      }
    }
    this.applyRead(at, { resend });
  }

  /** A command from Gladys. */
  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.monotonic();
    const parsed = this.parseId(feature?.external_id);
    if (!parsed || ![F.SWITCH, F.LIGHT, F.MODE].includes(parsed.key)) {
      throw this.refusal(parsed?.key === F.READONLY ? ERRORS.readOnly : ERRORS.notCommandable);
    }
    const wanted = integerOf(value);
    const kind = parsed.kind;
    if (!this.ready) {
      // The configuration not read yet (or being applied): ask for it now and wait a little.
      const protective =
        isProtective(kind, wanted) && (kind !== KINDS.PILOT || FP_CODE.has(wanted));
      // Kept in memory only (the key never goes to /data): while this click waits, it is its
      // own; past the wait, it is sent by the start that reads the configuration.
      const pending = protective ? { kind, value: wanted, waiting: true } : undefined;
      if (pending) this.pendingProtectives.set(parsed.code, pending);
      if (!this.configLoaded) this.askConfig();
      const ready = await this.waitReady(received + TIMINGS.configWait);
      if (this.pendingProtectives.get(parsed.code) === pending) {
        if (ready) this.pendingProtectives.delete(parsed.code);
        // Not ready means no client yet: the start that makes it sends it (ready is set in
        // the same turn as that adoption, so no click can fall between the two).
        else if (pending) pending.waiting = false;
      }
      if (!ready) {
        if (pending) throw this.refusal(ERRORS.keptUntilConfig);
        throw this.refusal(ERRORS.configNotLoaded);
      }
    }
    if (!this.client) throw this.refusal(ERRORS.noConfig);
    if (kind === KINDS.RELAY) {
      if (wanted !== 0 && wanted !== 1) throw this.refusal(ERRORS.badValue);
      if (!this.config.relays.has(parsed.code)) throw this.refusal(ERRORS.readOnly);
    } else if (kind === KINDS.PILOT) {
      if (wanted === undefined || !FP_CODE.has(wanted)) throw this.refusal(ERRORS.badValue);
    } else {
      throw this.refusal(ERRORS.notCommandable);
    }
    // Never to another Eco-Devices than the one these devices were made for, an Off neither.
    if (!this.mayDrive(isProtective(kind, wanted))) throw this.refusal(this.verdictError());
    const target = this.targetOf(parsed.code);
    if (!target || target.kind !== kind) throw this.refusal(ERRORS.unknownTarget);
    if (isProtective(kind, wanted)) {
      return this.protective(target, wanted, received);
    }
    // Not protective: the option, the pause, the key, a stop on the way, the room.
    if (kind === KINDS.PILOT && !this.config.allowHeatingModes) {
      throw this.refusal(ERRORS.heatingDisabled);
    }
    this.checkNotPaused(received);
    if (this.guards.get(target.code)?.userInFlight) throw this.refusal(ERRORS.stopPending);
    if (this.commands.length >= LIMITS.commandQueue) throw this.refusal(ERRORS.queueFull);
    const ahead = this.commands.length + (this.serving ? 1 : 0);
    return new Promise((resolve, reject) => {
      this.commands.push({
        code: target.code,
        kind,
        wanted,
        received,
        ahead,
        seq: this.seq,
        resolve,
        reject,
      });
      this.serveCommands();
    });
  }

  checkNotPaused(mono) {
    if (this.refusedApplies()) throw this.refusal(ERRORS.keyRefused);
    if (this.pause && this.pauseLeft(mono) > 0) {
      throw this.refusal(
        ERRORS.paused(
          this.lastReason ?? both('earlier reads failed', 'les lectures précédentes ont échoué'),
        ),
      );
    }
  }

  serveCommands() {
    if (this.serving) return this.serving;
    this.serving = (async () => {
      while (this.commands.length > 0) {
        const job = this.commands.shift();
        try {
          // The turn ends once the write is answered: the read back is awaited outside it.
          const { confirmation } = await this.command(job);
          confirmation.then(job.resolve, job.reject);
        } catch (err) {
          job.reject(err);
        }
      }
    })().finally(() => {
      this.serving = undefined;
      if (this.commands.length > 0) this.serveCommands();
    });
    return this.serving;
  }

  /** The checks right before a non-protective command leaves, on the configuration of now. */
  checkBeforeSend(job, generation, client) {
    if (generation !== this.generation || this.client !== client) {
      throw this.refusal(ERRORS.unknownTarget);
    }
    if (!this.mayDrive(false)) throw this.refusal(this.verdictError());
    if (job.kind === KINDS.PILOT && !this.config.allowHeatingModes) {
      throw this.refusal(ERRORS.heatingDisabled);
    }
    if (job.kind === KINDS.RELAY && !this.config.relays.has(job.code)) {
      throw this.refusal(ERRORS.readOnly);
    }
    const guard = this.guards.get(job.code);
    if (guard && (guard.userInFlight || guard.seq > job.seq)) {
      // A protective command came after this one: this one never leaves after it.
      throw this.refusal(ERRORS.cancelledByStop);
    }
    this.checkNotPaused(this.monotonic());
    if (this.monotonic() >= job.received + TIMINGS.commandSendBy) {
      throw this.refusal(ERRORS.late(job.ahead));
    }
  }

  /** A non-protective command, in its turn: resolves, once written, with the promise of its confirmation. */
  async command(job) {
    const generation = this.generation;
    const client = this.client;
    const target = this.targetOf(job.code);
    if (!client || !target) throw this.refusal(ERRORS.unknownTarget);
    this.checkBeforeSend(job, generation, client);
    // A guard of the target is lifted by this command once it has left; a
    // heating mode needs that written to /data before its first byte.
    const guard = this.guards.get(job.code);
    if (job.kind === KINDS.PILOT) {
      if (guard) this.guards.delete(job.code);
      const saved = await this.saveMemory();
      // Put back only where no newer guard took its place (an Off clicked meanwhile wins).
      if (guard && !this.guards.has(job.code)) this.guards.set(job.code, guard);
      if (!saved) {
        throw this.refusal(ERRORS.saveFailed);
      }
      if (generation !== this.generation) throw this.refusal(ERRORS.unknownTarget);
    }
    let left = false;
    let writtenAt;
    const restoreGuard = () => {
      if (guard && !this.guards.has(job.code)) this.guards.set(job.code, guard);
    };
    try {
      await this.write(client, target, job.wanted, PRIORITY.COMMAND, {
        deadline: job.received + TIMINGS.commandAnswerBy,
        beforeSend: () => this.checkBeforeSend(job, generation, client),
        onSent: () => {
          left = true;
          writtenAt = this.monotonic();
          // A newer command that left: the guard of this target ends here.
          if (this.guards.get(job.code) === guard) this.guards.delete(job.code);
          this.pendingWrites.set(job.code, {
            expected: job.wanted,
            at: this.monotonic(),
          });
        },
      });
    } catch (err) {
      if (
        left &&
        err instanceof Rt2Error &&
        ['refused', 'busy', 'http', 'not_success', 'wrong_product'].includes(err.code)
      ) {
        // Refused by the Eco-Devices: not a newer command, the guard stands.
        restoreGuard();
        this.pendingWrites.delete(job.code);
      }
      if (left) this.afterWrite(generation, groupOf(job.kind));
      this.saveMemory().catch(() => {});
      throw this.commandError(err, left, job.ahead);
    }
    this.saveMemory().catch(() => {});
    this.afterWrite(generation, groupOf(job.kind));
    const confirmation = this.confirm(job.code, job.kind, job.wanted, job.received, {
      after: writtenAt,
    });
    confirmation.catch(() => {});
    // Wrapped: an async function would otherwise wait for it.
    return { confirmation };
  }

  /** The error of a write: never "not sent" once it may have left. */
  commandError(err, left, ahead) {
    if (!(err instanceof Rt2Error)) return err;
    if (!left || !err.sent) {
      if (err.code === 'late') return this.refusal(ERRORS.late(ahead));
      if (err.code === 'cut') return this.refusal(ERRORS.cut);
      if (err.code === 'bad_request') return this.refusal(ERRORS.badValue);
      return this.refusal(ERRORS.notSent(reasonOf(err)));
    }
    if (err.code === 'refused') return this.refusal(ERRORS.keyRefused);
    if (['not_success', 'http', 'busy', 'wrong_product'].includes(err.code)) {
      return this.refusal(ERRORS.rejected);
    }
    return this.refusal(ERRORS.unconfirmed);
  }

  /**
   * The read back of a command that left: the value asked = done; the
   * value before = not applied yet; nothing in time = sent, unconfirmed.
   */
  async confirm(code, kind, wanted, received, { protective = false, after }) {
    const waitWrites = !protective;
    let read;
    if (waitWrites && this.serving) {
      // The commands waiting are written first (a scene): one read back then serves them all;
      // never past the time to send, so that the ack stays within the 5 s of Gladys.
      let timer;
      await Promise.race([
        this.serving.catch(() => {}),
        new Promise((resolve) => {
          timer = this.timers.setTimeout(
            resolve,
            Math.max(0, received + TIMINGS.commandSendBy - this.monotonic()),
          );
        }),
      ]);
      this.timers.clearTimeout(timer);
    }
    try {
      // A protective read back goes before the other commands, but any later Off clicked cuts it.
      read = await this.readBack(
        groupOf(kind),
        protective ? PRIORITY.GUARD : PRIORITY.CONFIRM,
        received + TIMINGS.commandAnswerBy,
        { after },
      );
    } catch {
      throw this.refusal(ERRORS.unconfirmed);
    }
    await this.refreshStatus();
    const value = read.values.get(code);
    if (value === wanted) return undefined;
    if (value === undefined) throw this.refusal(ERRORS.unconfirmed);
    throw this.refusal(ERRORS.notApplied(describe(kind, value), describe(kind, wanted)));
  }

  /** After a write that left: reads its group again 5 s and 20 s later (never skipped). */
  afterWrite(generation, group) {
    for (const delay of TIMINGS.followUps) {
      const timer = this.timers.setTimeout(() => {
        this.followUps.delete(timer);
        if (generation !== this.generation || !this.client) return undefined;
        return this.readBack(group, PRIORITY.CONFIRM, this.monotonic() + TIMINGS.requestTimeout, {
          resend: true,
        })
          .then(() => this.refreshStatus())
          .catch((err) =>
            this.logger.warn(`ecodevices-rt2: follow-up read failed: ${errorReason(err)}`),
          );
      }, delay);
      this.followUps.add(timer);
    }
  }

  /**
   * A protective command: no option, pause, refused key nor queue stops it.
   * It cancels the commands of the target still waiting, cuts the request in
   * flight, is tried again for 250 ms, and stays as a guard (in /data) sent
   * again by the reads until they show it.
   */
  async protective(target, wanted, received) {
    const client = this.client;
    const generation = this.generation;
    const code = target.code;
    for (const job of [...this.commands]) {
      if (job.code === code) {
        this.commands.splice(this.commands.indexOf(job), 1);
        job.reject(this.refusal(ERRORS.cancelledByStop));
      }
    }
    this.seq += 1;
    const guard = this.makeGuard({
      code,
      kind: target.kind,
      value: wanted,
      seq: this.seq,
      inFlight: true,
      userInFlight: true,
    });
    this.guards.set(code, guard);
    // Written to /data without waiting: a protective command never waits for the disk.
    this.saveMemory().catch(() => {});
    this.logger.info(
      `ecodevices-rt2: ${shownCode(code)} -> ${describe(target.kind, wanted).en} (protective)`,
    );
    const sendBy = received + TIMINGS.commandSendBy;
    let left = false;
    let lastError;
    const first = this.monotonic();
    for (;;) {
      try {
        await this.write(client, target, wanted, PRIORITY.PROTECTIVE, {
          deadline: received + TIMINGS.commandAnswerBy,
          beforeSend: () => {
            // Right before the first byte, at every try: a newer click on this target (say
            // during the wait between two tries) took its place; nothing leaves after it.
            if (this.guards.get(code) !== guard) throw new Rt2Error('late', 'superseded');
            if (!this.mayDrive(true)) {
              throw new Rt2Error('late', 'not the Eco-Devices of the devices');
            }
            if (this.monotonic() >= sendBy) throw new Rt2Error('late', 'no time left to send');
          },
          onSent: () => {
            left = true;
            guard.sentAt = this.monotonic();
          },
        });
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        const mono = this.monotonic();
        if (
          left ||
          !(err instanceof Rt2Error) ||
          generation !== this.generation ||
          this.guards.get(code) !== guard ||
          !this.mayDrive(true) ||
          mono - first >= TIMINGS.protectiveRetry ||
          mono >= sendBy
        ) {
          break;
        }
        await new Promise((resolve) => this.timers.setTimeout(resolve, TIMINGS.protectiveRetryGap));
        // A newer click during the wait: no new try at all, so that it cuts nothing (the read
        // back of that click, say). One already queued is stopped by `beforeSend` above.
        if (generation !== this.generation || this.guards.get(code) !== guard) {
          break;
        }
      }
    }
    guard.inFlight = false;
    guard.userInFlight = false;
    if (!left && !this.mayDrive(true)) {
      // Another Eco-Devices found meanwhile: not kept, never sent to it.
      if (this.guards.get(code) === guard) this.guards.delete(code);
      this.saveMemory().catch(() => {});
      throw this.refusal(this.verdictError());
    }
    this.saveMemory().catch(() => {});
    if (!left) {
      if (this.guards.get(code) !== guard) {
        // A later command on this target took its place.
        throw this.refusal(ERRORS.cancelledByStop);
      }
      // Kept: sent again as soon as the lane is free, and by the reads that show another value.
      // Still the click: ahead of the read backs.
      if (generation === this.generation) this.resendGuard(guard, PRIORITY.PROTECTIVE);
      this.refreshStatus().catch(() => {});
      throw this.refusal(ERRORS.protectiveKept(reasonOf(lastError)));
    }
    this.afterWrite(generation, groupOf(target.kind));
    if (lastError) {
      throw this.commandError(lastError, true, 0);
    }
    // Its read back is cut by any later Off clicked; it never waits for the other commands.
    return this.confirm(code, target.kind, wanted, received, {
      protective: true,
      after: guard.sentAt,
    });
  }
}
