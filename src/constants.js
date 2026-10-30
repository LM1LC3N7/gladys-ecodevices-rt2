// -----------------------------------------------------------------------------
// Constants: the local JSON API of the GCE Eco-Devices RT2, the targets the
// integration knows, the manifest keys, the limits and the timings.
//
// The API ("API Eco Devices RT", GCE Electronics, 01/02/2017; the keys of the
// answers as pyecodevices_rt2 1.3 reads them, MIT):
//   GET /api/xdevices.json?key=<API key>&<command> (no `key` when the
//   protection is off in the Eco-Devices), answered with
//   `"product": "EcoDevices_RT"` and `"status": "Success"`;
//   - `Get=R`: the 10 relays `R1`..`R10` (2 of the Eco-Devices, 8 of an X-8R);
//   - `Get=D`: the 12 digital inputs `D1`..`D12`;
//   - `Get=FP`: the zones of the X-4FP, `FP<ext> Zone <z>` as a text;
//   - `Get=XTHL`: the X-THL `THL<n>-TEMP|HUM|LUM`;
//   - `Index=all`: the indexes, `Index_TI<n>` (teleinformation),
//     `Index_TORE<n>` (current clamps), `Index_C<n>` (pulse counters);
//   - `SetR=01` / `ClearR=01` switch a relay on / off (01 to 10);
//   - `SetFPxx=y` sets the pilot-wire zone xx (01 to 08, never 00: "every
//     zone"): 0 Comfort, 1 Eco, 2 Frost protection, 3 Off, 4 Comfort -1,
//     5 Comfort -2.
// The API key travels in the query string: a URL is never logged, nor put in
// an error, a status or /data.
// -----------------------------------------------------------------------------

export const API = {
  defaultPort: 80,
  path: '/api/xdevices.json',
  keyParam: 'key',
  /** The `product` of every answer of an Eco-Devices RT2 (pyecodevices_rt2). */
  product: 'EcoDevices_RT',
};

/** The groups of the API read in a round, by the kind of targets they hold. */
export const READS = {
  RELAYS: 'Get=R',
  INPUTS: 'Get=D',
  PILOT: 'Get=FP',
  THL: 'Get=XTHL',
  INDEXES: 'Index=all',
};

/** The pilot-wire modes as Gladys numbers them (PILOT_WIRE_MODE of the core). */
export const PILOT = {
  OFF: 0,
  FROST_PROTECTION: 1,
  ECO: 2,
  COMFORT_1: 3,
  COMFORT_2: 4,
  COMFORT: 5,
};

/** Protective modes: never refused by an option, a pause, a queue or a read in progress. */
export const PROTECTIVE_MODES = [PILOT.OFF, PILOT.FROST_PROTECTION];

/** The text a zone reads -> the Gladys mode; the Gladys mode -> the `SetFPxx` code. */
export const FP_TEXT = new Map([
  ['Confort', PILOT.COMFORT],
  ['Eco', PILOT.ECO],
  ['Hors Gel', PILOT.FROST_PROTECTION],
  ['Arret', PILOT.OFF],
  ['Arrêt', PILOT.OFF],
  ['Confort -1', PILOT.COMFORT_1],
  ['Confort -2', PILOT.COMFORT_2],
]);
export const FP_CODE = new Map([
  [PILOT.COMFORT, 0],
  [PILOT.ECO, 1],
  [PILOT.FROST_PROTECTION, 2],
  [PILOT.OFF, 3],
  [PILOT.COMFORT_1, 4],
  [PILOT.COMFORT_2, 5],
]);

/** Kinds of targets (the type part of the external ids): frozen. */
export const KINDS = {
  RELAY: 'relay',
  INPUT: 'input',
  PILOT: 'pilot-wire',
  THL: 'thl',
  METER: 'meter',
};

/** Feature keys (the last part of the feature external ids): frozen. */
export const FEATURES = {
  /** Relays: the key is the kind the user gave it (a new kind adds a feature). */
  READONLY: 'readonly',
  SWITCH: 'switch',
  LIGHT: 'light',
  STATE: 'state',
  MODE: 'mode',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  LUMINOSITY: 'luminosity',
  /** Meters: the key is what it measures (a counter given another type adds a feature). */
  ENERGY: 'energy-index',
  WATER: 'water-index',
  GAS: 'gas-index',
};

/** What a relay declared in the configuration becomes. */
export const RELAY_KINDS = [FEATURES.SWITCH, FEATURES.LIGHT];

/**
 * What a pulse counter measures, and the units its index may be in (the
 * first one by default): the value published is in kWh (electricity) or m³.
 */
export const COUNTER_TYPES = {
  electricity: { units: ['wh', 'kwh'], feature: FEATURES.ENERGY },
  water: { units: ['l', 'm3'], feature: FEATURES.WATER },
  gas: { units: ['m3', 'l'], feature: FEATURES.GAS },
};
/** Published units per unit read. */
export const UNIT_FACTORS = { wh: 0.001, kwh: 1, l: 0.001, m3: 1 };

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  ATTACH: 'attach_devices',
  ACCEPT_HELD: 'accept_held_index',
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = { min: 5, max: 300, default: 15 };

/**
 * Sizes of the Eco-Devices RT2 (the API answers them all, wired or not):
 * relays 2 + 8 (X-8R), inputs 12, pilot-wire zones 8 (two X-4FP: `SetFP01`
 * to `SetFP08`), 2 X-THL, 7 teleinformation indexes, 16 clamps, 12 counters.
 */
export const LIMITS_RT2 = {
  relays: 10,
  ownRelays: 2,
  inputs: 12,
  zones: 8,
  thl: 2,
  ti: 7,
  tore: 16,
  counters: 12,
};

/** A measurement out of these ranges is not one (never published). */
export const RANGES = {
  temperature: { min: -40, max: 85 },
  humidity: { min: 0, max: 100 },
  luminosity: { min: 0, max: 200_000 },
};

/** An index read (Wh, litres, m³, kWh): a positive number up to this, else unknown. */
export const INDEX_MAX = 1e13;
/** The published index (kWh or m³) is bounded for Gladys. */
export const INDEX_FEATURE_MAX = 1e10;

/** Plausibility of the indexes (src/guard.js), in units per hour. */
export const GUARD_LIMITS = {
  /** Electricity (kWh): a home never draws more than 100 kW on average, 0.5 kWh slack. */
  [FEATURES.ENERGY]: { maxKw: 100, slackKwh: 0.5 },
  /** Water (m³): 10 m³/h at most (a home meter gives 2.5 to 4), 0.05 m³ slack. */
  [FEATURES.WATER]: { maxKw: 10, slackKwh: 0.05 },
  /** Gas (m³): 16 m³/h at most (a G4 meter gives 6, a G10 16), 0.05 m³ slack. */
  [FEATURES.GAS]: { maxKw: 16, slackKwh: 0.05 },
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** An answer is read up to this size, then dropped (an answer is a few KB). */
  responseBytes: 64 * 1024,
  /** Names are cut to this length. */
  nameLength: 60,
  /** Non-protective commands waiting (a scene); protective ones are never refused for room. */
  commandQueue: 16,
  /** Protective commands kept in /data to send again. */
  guards: 64,
  /** Index states kept in /data. */
  meters: 64,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of the polling. */
  requestTimeout: 5 * SECOND,
  /** A round (up to five requests) takes no longer than this. */
  roundBudget: 20 * SECOND,
  /** Failed rounds: 10 s, 30 s, 1, 2 then 5 min, never shorter than the interval. */
  backoff: [10 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** The Eco-Devices asks to wait (429, 503): at least a minute. */
  busyPause: MINUTE,
  /** A pause is never longer than this, whatever /data holds. */
  pauseMax: HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** "Test the connection" reads at most this often; it answers within 25 s (Gladys waits 30 s). */
  testCooldown: 10 * SECOND,
  testBudget: 25 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): written by 3.5 s after the
   * click or refused unsent; the read back awaited until 4.3 s, after which
   * the command is "sent, without confirmation" and read again later.
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** A protective command not sent at once is tried again during this budget. */
  protectiveRetry: 250,
  protectiveRetryGap: 50,
  /** A protective write without answer for this long is cut when another one waits. */
  stuckProtective: SECOND,
  /** Between two requests to the Eco-Devices (after the previous connection is closed). */
  laneGap: 10,
  /** A request cut by a protective command is closed within this (socket destroyed). */
  cutWait: 500,
  /** Reads after a command: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A protective command contradicted by the reads is sent again this many times at most. */
  resendMax: 3,
  /** The configuration of Gladys not read: new tries 5 s, 15 s, then every minute. */
  configRetry: [5 * SECOND, 15 * SECOND, MINUTE],
  /** A click while the configuration is unread asks for it at once (2 s apart at most) and waits this long. */
  configAskGap: 2 * SECOND,
  configWait: 3 * SECOND,
  /** "Attach the devices": the second click within this. */
  attachConfirm: MINUTE,
  /** "Accept the held index": the second click 3 s to 5 min after the first. */
  acceptAfter: 3 * SECOND,
  acceptWithin: 5 * MINUTE,
};
