// -----------------------------------------------------------------------------
// What the answers of the Eco-Devices RT2 mean (pure): the targets the
// integration knows and their values. A target is
//   { code, kind, n, value }
// `value`: 0 / 1 for a relay or an input, a Gladys pilot-wire mode (0-5) for
// a zone, `{ temperature, humidity, luminosity }` for an X-THL, the index in
// the published unit (kWh or m³) for a meter; `undefined` when the answer
// does not give it (absent, a text, out of range, 0 for an index: never 0).
//
// Every number is checked strictly (a text, '' or null is not 0), and nothing
// the Eco-Devices sends becomes an object key (Maps only): no prototype
// pollution.
// -----------------------------------------------------------------------------

import {
  API,
  COUNTER_TYPES,
  FEATURES,
  FP_TEXT,
  INDEX_MAX,
  KINDS,
  LIMITS,
  LIMITS_RT2,
  RANGES,
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
 * `bad_response` (no object, or no `product`: pyecodevices_rt2 refuses such an
 * answer too), `wrong_product` (another GCE product, an IPX800 V4 answering
 * the same API: its `product` given back, cleaned), `not_success` (a
 * `status` other than "Success").
 */
export function checkEnvelope(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'bad_response' };
  }
  const product = own(json, 'product');
  if (product === undefined) return { error: 'bad_response' };
  if (product !== API.product) {
    return { error: 'wrong_product', product: cleanName(String(product)) ?? '?' };
  }
  const status = own(json, 'status');
  if (status !== undefined && status !== 'Success') return { error: 'not_success' };
  return { ok: true };
}

/** The kind of a code; undefined when not one. */
export function kindOf(code) {
  const match = /^(r|d|fp|thl|ti|tore|c)(\d{1,2})$/.exec(code);
  if (!match) return undefined;
  const n = Number(match[2]);
  const max = {
    r: LIMITS_RT2.relays,
    d: LIMITS_RT2.inputs,
    fp: LIMITS_RT2.zones,
    thl: LIMITS_RT2.thl,
    ti: LIMITS_RT2.ti,
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

/** The value of a relay, input, zone or X-THL in its group's answer. */
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
  return undefined;
}

/** An index read: a JSON number, or a plain decimal text; undefined otherwise (never 0 from a text). */
export function indexNumber(raw) {
  let value;
  if (typeof raw === 'number') value = raw;
  else if (typeof raw === 'string' && /^\d{1,15}(?:\.\d{1,6})?$/.test(raw.trim())) {
    value = Number(raw.trim());
  }
  return Number.isFinite(value) && value >= 0 && value <= INDEX_MAX ? value : undefined;
}

/** The key of a meter in `Index=all`. */
export function indexKey(code) {
  const match = /^(ti|tore|c)(\d{1,2})$/.exec(code);
  if (!match) return undefined;
  return `Index_${{ ti: 'TI', tore: 'TORE', c: 'C' }[match[1]]}${match[2]}`;
}

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * What a meter measures and the value published from the raw index:
 * `{ feature, value }` (value undefined when not a positive number).
 * Teleinformation and clamps: Wh read, kWh published (unit of the reference,
 * to check on a real device); counters: as configured.
 */
export function meterOf(code, raw, counters) {
  const number = indexNumber(raw);
  let feature;
  let factor;
  if (/^(ti|tore)\d/.test(code)) {
    feature = FEATURES.ENERGY;
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
