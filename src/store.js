// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), bounded and checked when read back:
//   - the time of the last read attempt (a restart never reads sooner);
//   - the owner: the Eco-Devices the devices of this slot were created for
//     (its controller key: a hash of its address and port, the API giving no
//     MAC address), whatever the controller configured now;
//   - for the controller it belongs to, the pause after failed reads, the
//     refused API key (a salted 8-bit tag, never the key), and the
//     protective commands to send again (guards);
//   - the state of each index guard (src/guard.js): the last value published
//     and a value held back, with the Gladys device it belongs to.
// Never the API key nor the address. A small JSON file, written through a
// temporary file and a rename, one save after the other, readable by the
// container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { FEATURES, LIMITS, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/ecodevices-rt2-state.json';
/** The file of a slot. */
export const stateFile = (slot = 1) =>
  slot === 1 ? STATE_FILE : `/data/ecodevices-rt2-state-${Number(slot)}.json`;
/** The format of the file. */
export const FORMAT = 1;
/** A larger file is not ours: refused (read bounded). */
const MAX_STATE_BYTES = 256 * 1024;

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    /** null when there is no file (a fresh install); throws when it cannot be read or parsed. */
    async load() {
      let text;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
      if (Buffer.byteLength(text) > MAX_STATE_BYTES) {
        throw new Error('state file too large');
      }
      return JSON.parse(text);
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** The same in memory (tests). `fail`: the next saves throw; `unreadable`: load throws. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    fail: false,
    unreadable: false,
    async load() {
      if (this.unreadable) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      if (this.fail) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);
const isCode = (value) => typeof value === 'string' && /^[a-z]{1,4}\d{1,2}$/.test(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const METER_FEATURES = [FEATURES.ENERGY, FEATURES.WATER, FEATURES.GAS];

/** A guard read back: `{ code, value, resends, confirmed, other }`; undefined when not valid. */
function guardOf(raw) {
  // Only what a protective command writes: a relay off (0), a zone Off (0) or Frost protection (1).
  const valid =
    isCode(raw?.code) &&
    ((raw.kind === 'relay' && raw.value === 0) ||
      (raw.kind === 'pilot-wire' && (raw.value === 0 || raw.value === 1)));
  if (!valid) {
    return undefined;
  }
  return {
    code: raw.code,
    kind: raw.kind,
    value: raw.value,
    resends: Number.isInteger(raw.resends) ? Math.min(Math.max(raw.resends, 0), 99) : 0,
    confirmed: raw.confirmed === true,
    other: Number.isInteger(raw.other) && raw.other >= 0 && raw.other <= 5 ? raw.other : undefined,
  };
}

const HEX32 = /^[0-9a-f]{32}$/;

/** An owner read back: `{ kind: 'address', id }`; null when not valid. */
function ownerOf(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'address') return null;
  if (typeof raw.id !== 'string' || !HEX32.test(raw.id)) return null;
  return { kind: 'address', id: raw.id };
}

/** The state of an index guard read back; undefined when not valid. */
function meterOf(raw) {
  if (!raw || typeof raw !== 'object' || !METER_FEATURES.includes(raw.feature)) return undefined;
  const last =
    raw.last && finite(raw.last.value) && raw.last.value > 0 && finite(raw.last.at)
      ? { value: raw.last.value, at: raw.last.at }
      : null;
  const held =
    last &&
    raw.held &&
    ['up', 'down'].includes(raw.held.direction) &&
    ['from', 'to', 'threshold', 'at'].every((k) => finite(raw.held[k]))
      ? {
          direction: raw.held.direction,
          from: raw.held.from,
          to: raw.held.to,
          threshold: raw.held.threshold,
          at: raw.held.at,
        }
      : null;
  const device =
    typeof raw.device === 'string' && raw.device.length > 0 && raw.device.length <= 64
      ? raw.device
      : undefined;
  return { feature: raw.feature, ...(device ? { device } : {}), last, held };
}

/** An empty memory. */
export const emptyMemory = () => ({
  format: FORMAT,
  lastAttemptAt: null,
  salt: '',
  owner: null,
  key: '',
  pause: null,
  refused: null,
  guards: [],
  meters: {},
  foreign: null,
});

/**
 * The persisted state, repaired; dates in the future are brought to `now`
 * (wall clock), the end of a pause is capped from `now`, so a clock jump or
 * a hand-edited file never stops the reads for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const memory = emptyMemory();
  const lastAttemptAt = time(raw?.lastAttemptAt);
  memory.lastAttemptAt = lastAttemptAt === undefined ? null : Math.min(lastAttemptAt, now);
  const key = typeof raw?.key === 'string' && HEX32.test(raw.key) ? raw.key : '';
  memory.salt = typeof raw?.salt === 'string' && HEX32.test(raw.salt) ? raw.salt : '';
  memory.owner = ownerOf(raw?.owner);
  const foreign = raw?.foreign;
  if (foreign && typeof foreign.key === 'string' && HEX32.test(foreign.key)) {
    memory.foreign = {
      key: foreign.key,
      product:
        typeof foreign.product === 'string'
          ? // eslint-disable-next-line no-control-regex
            foreign.product.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 60)
          : '?',
    };
  }
  if (raw?.meters && typeof raw.meters === 'object' && !Array.isArray(raw.meters)) {
    let count = 0;
    for (const [code, value] of Object.entries(raw.meters)) {
      if (count >= LIMITS.meters) break;
      const meter = isCode(code) && /^(ti|tore|c)\d/.test(code) ? meterOf(value) : undefined;
      if (meter) {
        memory.meters[code] = meter;
        count += 1;
      }
    }
  }
  if (!key) {
    return memory;
  }
  memory.key = key;
  const p = raw?.pause;
  if (p && typeof p === 'object' && time(p.until)) {
    memory.pause = {
      until: Math.min(p.until, now + TIMINGS.pauseMax),
      failures: Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 0,
      code: p.code === 'busy' ? 'busy' : 'failed',
    };
  }
  const r = raw?.refused;
  if (
    r &&
    typeof r.salt === 'string' &&
    HEX32.test(r.salt) &&
    Number.isInteger(r.tag) &&
    r.tag >= 0 &&
    r.tag < 256
  ) {
    memory.refused = { salt: r.salt, tag: r.tag };
  }
  if (Array.isArray(raw?.guards)) {
    const seen = new Set();
    for (const entry of raw.guards.slice(0, LIMITS.guards)) {
      const guard = guardOf(entry);
      if (guard && !seen.has(guard.code)) {
        seen.add(guard.code);
        memory.guards.push(guard);
      }
    }
  }
  return memory;
}
