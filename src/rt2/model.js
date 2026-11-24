// -----------------------------------------------------------------------------
// What the answers of the Eco-Devices RT2 mean (pure): the targets the
// integration knows and their values. A target is
//   { code, kind, n, value }
// `value`: 0 / 1 for a relay or an input, a Gladys pilot-wire mode (0-5) for
// a zone, `{ temperature, humidity, luminosity }` for an X-THL,
// `{ apparentPower, current, period }` for the teleinformation details (the
// period: a code of TARIFF_PERIODS), the power (W) of a post, the index in
// the published unit (kWh or m³) for a meter; `undefined` when the answer
// does not give it (absent, a text, out of range, 0 for an index: never 0).
//
// Every number is checked strictly (a text, '' or null is not 0), and nothing
// the Eco-Devices sends becomes an object key (Maps only): no prototype
// pollution.
// -----------------------------------------------------------------------------

import {
  API,
  CLAMP_MODES,
  COUNTER_TYPES,
  FEATURES,
  FP_TEXT,
  INDEX_ABSENT,
  INDEX_MAX,
  KINDS,
  LIMITS,
  LIMITS_RT2,
  RANGES,
  TARIFF_PERIODS,
  UNIT_FACTORS,
} from '../constants.js';

const own = (object, key) =>
  object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key)
    ? object[key]
    : undefined;

/** 0 or 1 from a number, undefined otherwise. */
const bit = (value) => (value === 0 || value === 1 ? value : undefined);

/** A finite number within a range, undefined otherwise (never a text). */
const measure = (value, range) =>
  typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max
    ? value
    : undefined;

/** A name the Eco-Devices gives: printable, bounded; undefined otherwise. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, LIMITS.nameLength);
}

/**
 * The envelope of an answer: `{ ok: true }`, or `{ error }`:
 * `bad_response` (no object), `no_product` (no `product` field: pyecodevices_rt2
 * refuses such an answer too; said as such in the status), `wrong_product` (another GCE product, an IPX800 V4 answering
 * the same API: its `product` given back, cleaned), `not_success` (a
 * `status` other than "Success").
 */
export function checkEnvelope(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'bad_response' };
  }
  const product = own(json, 'product');
  if (product === undefined) return { error: 'no_product' };
  if (product !== API.product) {
    return { error: 'wrong_product', product: cleanName(String(product)) ?? '?' };
  }
  const status = own(json, 'status');
  if (status !== undefined && status !== 'Success') return { error: 'not_success' };
  return { ok: true };
}

/** The kind of a code; undefined when not one. */
export function kindOf(code) {
  const match = /^(r|d|fp|thl|ti|tic|tore|c|p)(\d{1,2})$/.exec(code);
  if (!match) return undefined;
  const n = Number(match[2]);
  const max = {
    r: LIMITS_RT2.relays,
    d: LIMITS_RT2.inputs,
    fp: LIMITS_RT2.zones,
    thl: LIMITS_RT2.thl,
    ti: LIMITS_RT2.ti,
    tic: LIMITS_RT2.tic,
    p: LIMITS_RT2.posts,
    tore: LIMITS_RT2.tore,
    c: LIMITS_RT2.counters,
  }[match[1]];
  if (n < 1 || n > max) return undefined;
  return {
    r: KINDS.RELAY,
    d: KINDS.INPUT,
    fp: KINDS.PILOT,
    thl: KINDS.THL,
    ti: KINDS.METER,
    tic: KINDS.TELEINFO,
    p: KINDS.POST,
    tore: KINDS.METER,
    c: KINDS.METER,
  }[match[1]];
}

/** The number at the end of a code. */
export const numberOf = (code) => Number(/\d+$/.exec(code)?.[0]);

/** The targets listed whatever is read: the 10 relays, the 12 inputs, the extensions given. */
export function fixedCodes(extensions) {
  const codes = new Set();
  for (let n = 1; n <= LIMITS_RT2.relays; n += 1) codes.add(`r${n}`);
  for (let n = 1; n <= LIMITS_RT2.inputs; n += 1) codes.add(`d${n}`);
  for (const code of extensions ?? []) codes.add(code);
  return codes;
}

/** `fp5` -> the key `FP2 Zone 1`. */
export const zoneKey = (n) => `FP${Math.floor((n - 1) / 4) + 1} Zone ${((n - 1) % 4) + 1}`;

/** A teleinformation number: a text of digits only (`"00870"`), or a number; undefined otherwise. */
function ticNumber(raw, range) {
  if (typeof raw === 'string' && /^\d{1,6}$/.test(raw.trim())) return measure(Number(raw), range);
  return Number.isInteger(raw) ? measure(raw, range) : undefined;
}

/**
 * What a `Get=TI` answer holds that this version does not read: `three-phase` (`IINST1`..`3`:
 * the current is not published), `not-historic` (none of `PAPP`, `IINST`, `PTEC` understood:
 * the standard mode of a Linky, say); undefined otherwise.
 */
export function teleinfoNote(json) {
  if (json === null || typeof json !== 'object') return undefined;
  if (valueOf(json, KINDS.TELEINFO, 1) === undefined) return 'not-historic';
  if (['IINST1', 'IINST2', 'IINST3'].some((key) => own(json, key) !== undefined)) {
    return 'three-phase';
  }
  return undefined;
}

/** The value of a relay, input, zone, X-THL, teleinformation or post in its group's answer. */
export function valueOf(json, kind, n) {
  if (kind === KINDS.RELAY) return bit(own(json, `R${n}`));
  if (kind === KINDS.INPUT) return bit(own(json, `D${n}`));
  if (kind === KINDS.PILOT) {
    const text = own(json, zoneKey(n));
    return typeof text === 'string' ? FP_TEXT.get(text.trim()) : undefined;
  }
  if (kind === KINDS.THL) {
    const value = {
      temperature: measure(own(json, `THL${n}-TEMP`), RANGES.temperature),
      humidity: measure(own(json, `THL${n}-HUM`), RANGES.humidity),
      luminosity: measure(own(json, `THL${n}-LUM`), RANGES.luminosity),
    };
    return value.temperature === undefined &&
      value.humidity === undefined &&
      value.luminosity === undefined
      ? undefined
      : value;
  }
  if (kind === KINDS.TELEINFO) {
    const ptec = own(json, 'PTEC');
    const period = typeof ptec === 'string' ? ptec.trim() : undefined;
    const value = {
      apparentPower: ticNumber(own(json, 'PAPP'), RANGES.apparentPower),
      current: ticNumber(own(json, 'IINST'), RANGES.current),
      period: TARIFF_PERIODS.has(period) ? period : undefined,
    };
    return Object.values(value).every((v) => v === undefined) ? undefined : value;
  }
  if (kind === KINDS.POST) return measure(own(json, `INSTANT_POSTE${n}`), RANGES.power);
  return undefined;
}

/**
 * A zone answered with a number instead of a mode text (0 on a real RT2): not understood, so
 * neither published nor taken for a mode (pyecodevices_rt2 maps a 0 to "unknown").
 */
export const zoneIsNumber = (json, n) => typeof own(json, zoneKey(n)) === 'number';

/**
 * An index read: a JSON number, or a plain decimal text; undefined otherwise (never 0 from a
 * text, never 4294967295: an entry with nothing behind it).
 */
export function indexNumber(raw) {
  let value;
  if (typeof raw === 'number') value = raw;
  else if (typeof raw === 'string' && /^\d{1,15}(?:\.\d{1,6})?$/.test(raw.trim())) {
    value = Number(raw.trim());
  }
  if (value === INDEX_ABSENT) return undefined;
  return Number.isFinite(value) && value >= 0 && value <= INDEX_MAX ? value : undefined;
}

/** The key of a meter in `Index=all`. */
export function indexKey(code) {
  const match = /^(ti|tore|c)(\d{1,2})$/.exec(code);
  if (!match) return undefined;
  return `Index_${{ ti: 'TI', tore: 'TORE', c: 'C' }[match[1]]}${match[2]}`;
}

/** Texts the web interface and the API use for "no value" (status.json: `"--      "`). */
const EMPTY_TEXTS = new Set(['', '-', '--', '---', '----', 'n/a', 'na', 'null', 'none']);

/**
 * The entry of a meter in an `Index=all` (or `Index=T`) answer, whatever the
 * spelling of its key, and why it gives no value when it does not:
 * `{ key, raw, why }`. The key is `Index_TORE3` (firmware 3; `Index_TI1`,
 * `Index_C1`), taken too as `Index_TORE_3`, `INDEX_TORE3`, `Index_Tore3` or
 * `index_tore3` (firmware 2 spelled the clamps `Index_TORE_Cons1`, `Get=all`
 * spells the pulse counters `INDEX_C1`: a spelling is never a reason to lose
 * an index). `why`:
 *   - `absent`: no such key in the answer (a firmware that does not give it);
 *   - `empty`: null, "", "--" (status.json shows "--" for a power counter
 *     bound to no clamp, or erased), "N/A";
 *   - `unbound`: 4294967295 (0xFFFFFFFF), an entry with nothing behind it;
 *   - `zero`: 0 (a counter that counted nothing yet: no clamp, a clamp facing
 *     the wrong way, a mode not matching the clamp);
 *   - `unreadable`: anything else (a text, a negative number, too large);
 *   - undefined when the entry is an index above 0 (`raw` then a number).
 */
export function indexEntry(json, code) {
  const exact = indexKey(code);
  if (!exact || json === null || typeof json !== 'object') {
    return { key: undefined, raw: undefined, why: 'absent' };
  }
  const [, prefix, n] = /^(ti|tore|c)(\d{1,2})$/.exec(code);
  const pattern = new RegExp(`^index_?${prefix}_?${n}$`, 'i');
  let key;
  if (Object.hasOwn(json, exact)) key = exact;
  else key = Object.keys(json).find((k) => pattern.test(k));
  if (key === undefined) return { key: undefined, raw: undefined, why: 'absent' };
  const raw = Object.getOwnPropertyDescriptor(json, key)?.value;
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  let why;
  if (raw === null || raw === undefined || (text !== undefined && EMPTY_TEXTS.has(text))) {
    why = 'empty';
  } else if (raw === INDEX_ABSENT || text === String(INDEX_ABSENT)) {
    why = 'unbound';
  } else {
    const number = indexNumber(raw);
    if (number === undefined) why = 'unreadable';
    else if (number === 0) why = 'zero';
  }
  return { key, raw, why };
}

/** True when the answer holds at least one power-counter key (firmware 3 spelling). */
export const hasToreKeys = (json) =>
  json !== null &&
  typeof json === 'object' &&
  Object.keys(json).some((k) => /^index_?tore_?\d/i.test(k));

/** True when the answer spells the clamps as firmware 2 did (`Index_TORE_Cons1`): no power counter in it. */
export const isFirmware2Indexes = (json) =>
  json !== null &&
  typeof json === 'object' &&
  Object.keys(json).some((k) => /^index_?tore_?(cons|dist)\d/i.test(k));

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * What a meter measures and the value published from the raw index:
 * `{ feature, value }` (value undefined when not a positive number).
 * Teleinformation: Wh read, kWh published (confirmed on a real RT2, see
 * UNIT_CONFIRMED); power counters (`tore`): Wh read, kWh published, the
 * feature by the mode of the configuration (undefined when not listed);
 * pulse counters: as configured (undefined when not listed).
 */
export function meterOf(code, raw, counters, clamps) {
  const number = indexNumber(raw);
  let feature;
  let factor;
  if (/^ti\d/.test(code)) {
    feature = FEATURES.ENERGY;
    factor = UNIT_FACTORS.wh;
  } else if (/^tore\d/.test(code)) {
    const clamp = clamps?.get(code);
    if (!clamp) return undefined;
    feature = CLAMP_MODES[clamp.mode].feature;
    factor = UNIT_FACTORS.wh;
  } else {
    const counter = counters?.get(code);
    if (!counter) return undefined;
    feature = COUNTER_TYPES[counter.type].feature;
    factor = UNIT_FACTORS[counter.unit];
  }
  const value = number !== undefined && number > 0 ? round3(number * factor) : undefined;
  return { feature, value, raw: number };
}

/** The query of a write: `SetR=03`, `ClearR=03`, `SetFP05=3`; undefined when not one. */
export function writeQuery(target, value, fpCode) {
  const nn = String(target.n).padStart(2, '0');
  if (target.kind === KINDS.RELAY && target.n >= 1 && target.n <= LIMITS_RT2.relays) {
    return value === 1 ? `SetR=${nn}` : value === 0 ? `ClearR=${nn}` : undefined;
  }
  // Never zone 00: it drives every zone at once.
  if (
    target.kind === KINDS.PILOT &&
    target.n >= 1 &&
    target.n <= LIMITS_RT2.zones &&
    fpCode !== undefined
  ) {
    return `SetFP${nn}=${fpCode}`;
  }
  return undefined;
}
