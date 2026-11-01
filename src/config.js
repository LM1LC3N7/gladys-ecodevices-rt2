// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// Target codes (what the user types and reads in the device names), always
// stored lower case: `r<n>` relay 1-10, `d<n>` digital input 1-12, `fp<n>`
// pilot-wire zone 1-8 (zone z of the X-4FP e: 4 * (e - 1) + z, the `SetFPxx`
// number), `thl<n>` X-THL 1-2, `ti<n>` teleinformation index 1-7, `tore<n>`
// current clamp 1-20, `c<n>` pulse counter 1-12.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { API, COUNTER_TYPES, LIMITS_RT2, POLL_INTERVAL, RELAY_KINDS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  allow_heating_modes: false,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * The address typed by the user: `{ host, port }`, `{ error: 'path' }` when it
 * holds a path, a query or credentials (a pasted URL, maybe with the key),
 * `{ error: 'https' }`, `{ error: 'invalid' }`, `{}` when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  if (/^https:\/\//i.test(text)) {
    return { error: 'https' };
  }
  text = text.replace(/^http:\/\//i, '').replace(/\/$/, '');
  if (/[/?#@\s]/.test(text)) {
    return { error: 'path' };
  }
  let host = text;
  let port;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else if (isIP(text) !== 6) {
    const withPort = /^([^:]+):(\d{1,5})$/.exec(text);
    if (withPort) {
      host = withPort[1];
      port = withPort[2];
    } else if (text.includes(':')) {
      return { error: 'invalid' };
    }
  }
  if (isIP(host) === 0 && !HOSTNAME.test(host)) {
    return { error: 'invalid' };
  }
  if (isIP(host) === 4 && /^(0\.|255\.255\.255\.255$|22[4-9]\.|23\d\.)/.test(host)) {
    // Neither "this network", the broadcast nor a multicast group.
    return { error: 'invalid' };
  }
  const portNumber = port === undefined ? API.defaultPort : Number(port);
  if (portNumber < 1 || portNumber > 65535) {
    return { error: 'invalid' };
  }
  return { host: host.toLowerCase(), port: portNumber };
}

/** The key of a controller in /data: a hash of its address and port (never the API key). */
export const controllerKey = (host, port) =>
  host
    ? createHash('sha256')
        .update(`ecodevices-rt2:${host}:${port}`, 'utf8')
        .digest('hex')
        .slice(0, 32)
    : '';

/** An API key: printable ASCII without space, 1 to 128 characters; '' when absent; null when invalid. */
export function parseApiKey(raw) {
  if (raw === undefined || raw === null) {
    return '';
  }
  const text = String(raw).trim();
  if (text === '') {
    return '';
  }
  return /^[\x21-\x7e]{1,128}$/.test(text) ? text : null;
}

const RELAY = /^r(\d{1,2})$/;

/** A relay code, normalized (`r3`); undefined when invalid. */
export function relayCode(text) {
  const match = RELAY.exec(String(text).trim().toLowerCase());
  if (!match) return undefined;
  const n = Number(match[1]);
  return n >= 1 && n <= LIMITS_RT2.relays ? `r${n}` : undefined;
}

/**
 * The relays Gladys may drive: `R1, R3:light` -> Map(code -> kind).
 * A bare number is a relay (`3` = `R3`); no kind = a switch.
 * Every other relay is read only. Wrong entries are reported, not fatal.
 */
export function parseRelays(raw) {
  const relays = new Map();
  const errors = [];
  for (const entry of String(raw ?? '').split(/[,;\n]+/)) {
    const text = entry.trim();
    if (text === '') continue;
    const match = /^([^:=\s]+)\s*(?:[:=]\s*([a-z]+))?$/i.exec(text);
    const name = match ? (/^\d+$/.test(match[1]) ? `r${match[1]}` : match[1]) : '';
    const code = match ? relayCode(name) : undefined;
    const kind = (match?.[2] ?? 'switch').toLowerCase();
    if (!code || !RELAY_KINDS.includes(kind)) {
      errors.push(text.slice(0, 20));
      continue;
    }
    relays.set(code, kind);
  }
  return { relays, errors: errors.slice(0, 10) };
}

const RANGE = { fp: LIMITS_RT2.zones, thl: LIMITS_RT2.thl };

/**
 * The extensions wired to the Eco-Devices (the API answers their values
 * whether they are there or not): pilot-wire zones `FP1-FP8` (four per
 * X-4FP), X-THL `THL1-THL2`.
 */
export function parseExtensions(raw) {
  const codes = new Set();
  const errors = [];
  for (const entry of String(raw ?? '').split(/[,;\n]+/)) {
    const text = entry.trim().toLowerCase().replace(/\s+/g, '');
    if (text === '') continue;
    const match = /^(fp|thl)(\d{1,2})(?:-(fp|thl)?(\d{1,2}))?$/.exec(text);
    const prefix = match?.[1];
    const first = Number(match?.[2]);
    const last = match?.[4] === undefined ? first : Number(match[4]);
    if (
      !match ||
      (match[3] !== undefined && match[3] !== prefix) ||
      first < 1 ||
      last < first ||
      last > RANGE[prefix]
    ) {
      errors.push(entry.trim().slice(0, 20));
      continue;
    }
    for (let n = first; n <= last; n += 1) {
      codes.add(`${prefix}${n}`);
    }
  }
  return { codes, errors: errors.slice(0, 10) };
}

/**
 * The pulse counters to publish and what they measure: `C1:water:l,
 * C2:gas:m3, C3:electricity:wh` -> Map(code -> { type, unit }); the unit is
 * the one of the Eco-Devices index (the first of the type when not given).
 */
export function parseCounters(raw) {
  const counters = new Map();
  const errors = [];
  for (const entry of String(raw ?? '').split(/[,;\n]+/)) {
    const text = entry.trim().toLowerCase().replace(/\s+/g, '').replace('m³', 'm3');
    if (text === '') continue;
    const match = /^c(\d{1,2})[:=]([a-z]+)(?::([a-z0-9]+))?$/.exec(text);
    const n = Number(match?.[1]);
    const type =
      match && Object.hasOwn(COUNTER_TYPES, match[2]) ? COUNTER_TYPES[match[2]] : undefined;
    const unit = match?.[3] ?? type?.units[0];
    if (
      !type ||
      n < 1 ||
      n > LIMITS_RT2.counters ||
      !type.units.includes(unit) ||
      counters.has(`c${n}`)
    ) {
      errors.push(entry.trim().slice(0, 24));
      continue;
    }
    counters.set(`c${n}`, { type: match[2], unit });
  }
  return { counters, errors: errors.slice(0, 10) };
}

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

/** A boolean option: true only when the value is `true` or the text "true". */
const flag = (value, fallback) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : fallback;

export function normalizeConfig(raw = {}) {
  const address = parseAddress(raw?.host);
  const typedPort = number(raw?.port);
  const port =
    address.port !== undefined && address.port !== API.defaultPort
      ? address.port
      : clamp(typedPort, { min: 1, max: 65535 }, API.defaultPort);
  const apiKey = parseApiKey(raw?.api_key);
  const relays = parseRelays(raw?.relays);
  const extensions = parseExtensions(raw?.extensions);
  const counters = parseCounters(raw?.counters);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    host: address.host ?? '',
    port,
    addressError: address.error,
    key: controllerKey(address.host, port),
    apiKey: apiKey ?? '',
    apiKeyInvalid: apiKey === null,
    relays: relays.relays,
    relayErrors: relays.errors,
    extensions: extensions.codes,
    extensionErrors: extensions.errors,
    counters: counters.counters,
    counterErrors: counters.errors,
    allowHeatingModes: flag(raw?.allow_heating_modes, DEFAULTS.allow_heating_modes),
    // Set by src/hub.js: the address of an earlier slot (one box, one lane of requests).
    duplicateOf: Number.isInteger(raw?.duplicate_of) ? raw.duplicate_of : undefined,
    pollInterval: clamp(number(raw?.poll_interval), POLL_INTERVAL, DEFAULTS.poll_interval),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}

/**
 * Up to SLOTS Eco-Devices RT2 in one integration (Gladys runs one instance
 * of it). The first one has the manifest keys `host`, `port`, `api_key`,
 * `relays`, `extensions`, `counters`; the n-th one has them with `_<n>`
 * (`host_2`...), its port in the address (`192.168.1.51:8080`). The poll
 * interval, the heating option and the language are shared.
 */
export const SLOTS = 3;

const SLOT_KEYS = ['host', 'api_key', 'relays', 'extensions', 'counters'];
const SHARED_KEYS = ['allow_heating_modes', 'poll_interval', 'language'];

/** The configuration of one slot, in the shape of the first one (for normalizeConfig). */
export function slotConfig(raw, slot) {
  if (slot === 1) return raw ?? {};
  const out = {};
  for (const key of SLOT_KEYS) out[key] = raw?.[`${key}_${slot}`];
  for (const key of SHARED_KEYS) out[key] = raw?.[key];
  return out;
}

/**
 * The configuration of a slot whose address (host and port) is the one of an earlier slot gets
 * `duplicate_of`: it is not read (two lanes would hit one box). From gladys-ipx800.
 */
export function slotConfigs(raw, slots = SLOTS) {
  const seen = new Map();
  const out = new Map();
  for (let slot = 1; slot <= slots; slot += 1) {
    const config = slotConfig(raw, slot);
    const { host, port } = normalizeConfig(config);
    const address = host ? `${host}:${port}` : '';
    if (address && seen.has(address)) {
      out.set(slot, { ...config, duplicate_of: seen.get(address) });
    } else {
      if (address) seen.set(address, slot);
      out.set(slot, config);
    }
  }
  return out;
}

/** True when a slot after the first one has an address typed. */
export const slotTyped = (raw, slot) =>
  slot === 1 || String(raw?.[`host_${slot}`] ?? '').trim() !== '';

/**
 * True when the address is there and valid (the API key may be empty: the
 * protection can be turned off in the Eco-Devices), and the key valid.
 */
export const isComplete = (config) =>
  config.host !== '' && config.addressError === undefined && !config.apiKeyInvalid;

/** What a session depends on: a change starts again (and lifts a refused key). */
export const sessionKey = (config) =>
  JSON.stringify([
    config.host,
    config.port,
    config.apiKey,
    config.addressError,
    config.duplicateOf,
  ]);
