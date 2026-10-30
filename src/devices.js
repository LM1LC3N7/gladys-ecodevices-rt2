// -----------------------------------------------------------------------------
// The targets of the Eco-Devices RT2 -> Gladys devices and states (pure).
//
// `ext:<selector>:<kind>:<code>`: one Gladys device per relay, digital input,
// pilot-wire zone, X-THL and index (teleinformation, clamp, pulse counter),
// keyed by the code of the target (`r3`, `d5`, `fp5`, `thl1`, `ti1`,
// `tore3`, `c2`: see src/config.js). The Eco-Devices n of the configuration
// (n >= 2) puts `rt2<n>:` before the kind (`ext:<selector>:rt22:relay:r3`).
// The kinds, the slot prefix and the feature keys are published forever:
// never rename them. Which Eco-Devices a slot's devices belong to is kept in
// /data (the owner, see src/app.js), never in the ids.
//
// Relays: read only (`readonly`, a state nobody can drive) unless the user
// declared them in "Relays Gladys may drive", as a switch (`switch`) or a
// light (`light`). A switch or a light obeys every "turn everything off"
// (Google, Alexa, the MCP, the scenes): only the relays the user declares
// get one. The feature key is the kind: declaring a relay adds a feature and
// keeps the old one (and its history). Commands are checked against the
// configuration of now in src/app.js, whatever feature they come from.
//
// Pilot-wire zones: `heater/pilot-wire-mode` (Gladys numbers the modes 0 Off
// to 5 Comfort); the heating modes are refused unless allowed (src/app.js).
//
// Indexes: `energy-sensor/index` in kWh (teleinformation, clamps, an
// electricity counter), `volume-sensor/decimal` in m³ (a water or gas
// counter: never an energy index), each through its guard (src/guard.js).
//
// A device published again never loses a feature: those of the device
// already created in Gladys are kept as they are.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { FEATURES as F, INDEX_FEATURE_MAX, KINDS, PILOT, RANGES } from './constants.js';
import { FEATURE_NAMES, slotName, targetName, word } from './i18n.js';

const KIND_LIST = Object.values(KINDS);

/** "Eco-Devices RT2", "Eco-Devices RT2 X-4FP"... from the code. */
export const modelOf = (code) => {
  const prefix = /^(fp|thl|ti|tore|c)\d/.exec(code)?.[1];
  const model = { fp: 'X-4FP', thl: 'X-THL', ti: 'TIC', tore: 'Tore', c: 'Compteur' }[prefix];
  if (/^r([3-9]|10)$/.test(code)) return 'Eco-Devices RT2 X-8R';
  return model ? `Eco-Devices RT2 ${model}` : 'Eco-Devices RT2';
};

/** The features of a kind (a relay: of its declared kind; a meter: what it measures). */
export function featureKeys(kind, relayKind, meterFeature) {
  switch (kind) {
    case KINDS.RELAY:
      return [relayKind ?? F.READONLY];
    case KINDS.INPUT:
      return [F.STATE];
    case KINDS.PILOT:
      return [F.MODE];
    case KINDS.METER:
      return meterFeature ? [meterFeature] : [];
    default:
      return [F.TEMPERATURE, F.HUMIDITY, F.LUMINOSITY];
  }
}

/** The definition of a feature, by key. */
export function definitionOf(key) {
  const binary = { min: 0, max: 1, keep_history: true };
  switch (key) {
    case F.READONLY:
      return {
        category: C.SWITCH,
        type: T.SWITCH.BINARY,
        ...binary,
        read_only: true,
        has_feedback: false,
      };
    case F.SWITCH:
      return {
        category: C.SWITCH,
        type: T.SWITCH.BINARY,
        ...binary,
        read_only: false,
        has_feedback: true,
      };
    case F.LIGHT:
      return {
        category: C.LIGHT,
        type: T.LIGHT.BINARY,
        ...binary,
        read_only: false,
        has_feedback: true,
      };
    case F.STATE:
      return {
        category: C.INPUT,
        type: T.INPUT.BINARY,
        ...binary,
        read_only: true,
        has_feedback: false,
      };
    case F.MODE:
      return {
        category: C.HEATER,
        type: T.HEATER.PILOT_WIRE_MODE,
        min: PILOT.OFF,
        max: PILOT.COMFORT,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      };
    case F.TEMPERATURE:
      return {
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.CELSIUS,
        ...RANGES.temperature,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    case F.HUMIDITY:
      return {
        category: C.HUMIDITY_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.PERCENT,
        ...RANGES.humidity,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    case F.LUMINOSITY:
      return {
        category: C.LIGHT_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.LUX,
        ...RANGES.luminosity,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    case F.ENERGY:
      return {
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.INDEX,
        unit: U.KILOWATT_HOUR,
        min: 0,
        max: INDEX_FEATURE_MAX,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    case F.WATER:
    case F.GAS:
      return {
        category: C.VOLUME_SENSOR,
        type: T.VOLUME_SENSOR.DECIMAL,
        unit: U.CUBIC_METER,
        min: 0,
        max: INDEX_FEATURE_MAX,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      };
    default:
      throw new Error(`unknown feature ${key}`);
  }
}

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

export const idsOf = (gladys, kind, code) => gladys.externalIds(kind, code);

/** What a slot puts before the kind in its ids: '' for the first one, `rt2<n>:` after. */
export const slotPrefix = (slot = 1) => (slot === 1 ? '' : `rt2${slot}:`);

const ID = /:(relay|input|pilot-wire|thl|meter):([a-z]{1,4}\d{1,2})(?::([a-z-]{1,20}))?$/;

/** The kind, code and feature key of one of our external ids of `slot`; undefined otherwise. */
export function parseExternalId(externalId, selector, slot = 1) {
  const head = `ext:${selector}:${slotPrefix(slot)}`;
  if (typeof externalId !== 'string' || !externalId.startsWith(head)) {
    return undefined;
  }
  const match = ID.exec(externalId);
  if (!match || !KIND_LIST.includes(match[1])) return undefined;
  if (externalId !== `${head}${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ''}`) {
    return undefined;
  }
  return { kind: match[1], code: match[2], key: match[3] };
}

/** The slot of one of our external ids (`ext:<selector>:rt22:...` -> 2); 1 otherwise. */
export function slotOf(externalId, selector) {
  const match = /^rt2([2-9]):/.exec(
    typeof externalId === 'string' && externalId.startsWith(`ext:${selector}:`)
      ? externalId.slice(`ext:${selector}:`.length)
      : '',
  );
  return match ? Number(match[1]) : 1;
}

/**
 * The states of a target read: `[key, state]` pairs, only for the values
 * read (an unknown value publishes nothing, never 0). A relay's state goes
 * to every relay key (`keys`: those of the created device).
 */
export function targetStates(target, keys) {
  const value = target.value;
  if (value === undefined) return [];
  switch (target.kind) {
    case KINDS.RELAY:
      return [F.READONLY, F.SWITCH, F.LIGHT]
        .filter((key) => keys?.has(key))
        .map((key) => [key, { state: value }]);
    case KINDS.INPUT:
      return [[F.STATE, { state: value }]];
    case KINDS.PILOT:
      // A mode out of 0-5 (several modes on) is not one: never published.
      return Number.isInteger(value) && value >= 0 && value <= 5
        ? [[F.MODE, { state: value }]]
        : [];
    case KINDS.METER:
      // The value the guard let through (src/app.js), never 0.
      return target.feature && Number.isFinite(value) && value > 0
        ? [[target.feature, { state: value }]]
        : [];
    default:
      return [
        [F.TEMPERATURE, value.temperature],
        [F.HUMIDITY, value.humidity],
        [F.LUMINOSITY, value.luminosity],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => [key, { state: v }]);
  }
}

/**
 * The Gladys device of a target. `created`: the device already created in
 * Gladys, whose name and features are kept.
 */
export function buildDevice(gladys, target, { language, relayKind, created, slot = 1 }) {
  const meterFeature = target.kind === KINDS.METER ? target.feature : undefined;
  const ids = idsOf(gladys, target.kind, target.code);
  const built = {
    name: created?.name ?? word(slotName(slot, targetName(target)), language),
    external_id: ids.device,
    model: modelOf(target.code),
    should_poll: false,
    features: featureKeys(target.kind, relayKind, meterFeature).map((key) => ({
      name: word(FEATURE_NAMES[key], language),
      external_id: ids.feature(key),
      ...definitionOf(key),
    })),
    params: [{ name: 'code', value: target.code.toUpperCase() }],
  };
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  return { ...built, features: [...built.features, ...kept] };
}
