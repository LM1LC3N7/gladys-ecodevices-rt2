// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// refusals of a command), in English and French.
// -----------------------------------------------------------------------------

import { FEATURES as F, KINDS, PILOT } from './constants.js';

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const both = (en, fr) => ({ en, fr });

/** Several messages one after the other, in each language. */
export const join = (...messages) => {
  const parts = messages.filter(Boolean);
  return both(parts.map((m) => m.en).join(' '), parts.map((m) => m.fr).join(' '));
};

/** "45 s" / "25 min" / "3 h", for the waits. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** Lists the first 5 entries, then "and N more". */
export function listOf(entries) {
  const shown = entries.slice(0, 5);
  const more = entries.length - shown.length;
  return both(
    shown.join(', ') + (more > 0 ? ` and ${more} more` : ''),
    shown.join(', ') + (more > 0 ? ` et ${more} autre(s)` : ''),
  );
}

/** A number as the user reads it (3 decimals at most). */
export const number = (value, lang) =>
  Number(value).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 3 });

export const MODE_NAMES = new Map([
  [PILOT.OFF, both('Off', 'Arrêt')],
  [PILOT.FROST_PROTECTION, both('Frost protection', 'Hors-gel')],
  [PILOT.ECO, both('Eco', 'Éco')],
  [PILOT.COMFORT_1, both('Comfort -1', 'Confort -1')],
  [PILOT.COMFORT_2, both('Comfort -2', 'Confort -2')],
  [PILOT.COMFORT, both('Comfort', 'Confort')],
]);

/** A value as the user reads it. */
export function describe(kind, value) {
  if (value === undefined) return both('unknown', 'inconnu');
  if (kind === KINDS.PILOT) return MODE_NAMES.get(value) ?? both('unknown', 'inconnu');
  return value === 1 ? both('on', 'allumé') : both('off', 'éteint');
}

export const FEATURE_NAMES = {
  // Right in both states: a relay listed later keeps this feature next to its switch, under
  // the name it was created with (Gladys never renames it, and it cannot be deleted alone).
  // What to do lives in the status and the guide.
  [F.READONLY]: both('State (read only)', 'État (lecture seule)'),
  [F.SWITCH]: both('Switch', 'Interrupteur'),
  [F.LIGHT]: both('Light', 'Lumière'),
  [F.STATE]: both('State', 'État'),
  [F.MODE]: both('Pilot wire', 'Fil pilote'),
  [F.TEMPERATURE]: both('Temperature', 'Température'),
  [F.HUMIDITY]: both('Humidity', 'Humidité'),
  [F.LUMINOSITY]: both('Luminosity', 'Luminosité'),
  [F.ENERGY]: both('Energy index', 'Index d’énergie'),
  [F.WATER]: both('Water index', 'Index d’eau'),
  [F.GAS]: both('Gas index', 'Index de gaz'),
  [F.PRODUCTION]: both('Production index', 'Index de production'),
  [F.INJECTION]: both('Injection index', 'Index d’injection'),
  [F.DRAWN]: both('Drawn index', 'Index de soutirage'),
  [F.APPARENT_POWER]: both('Apparent power', 'Puissance apparente'),
  [F.CURRENT]: both('Current', 'Intensité'),
  [F.TARIFF_PERIOD]: both('Tariff period', 'Période tarifaire'),
  [F.POWER]: both('Instant power', 'Puissance instantanée'),
};

/** The code as the user types it: `R3`, `FP5`, `TORE2`. */
export const shownCode = (code) => code.toUpperCase();

/** The name of a target in Gladys: "Relay 3 (R3)", "Power counter 2 (TORE2)". */
export function targetName(target) {
  const code = shownCode(target.code);
  const n = target.n;
  switch (target.kind) {
    case KINDS.RELAY:
      return both(`Relay ${n} (${code})`, `Relais ${n} (${code})`);
    case KINDS.INPUT:
      return both(`Input ${n} (${code})`, `Entrée ${n} (${code})`);
    case KINDS.PILOT:
      return both(`Pilot wire zone ${n} (${code})`, `Fil pilote zone ${n} (${code})`);
    case KINDS.METER:
      if (target.code.startsWith('ti')) {
        return both(`Teleinfo index ${n} (${code})`, `Index téléinfo ${n} (${code})`);
      }
      if (target.code.startsWith('tore')) {
        return both(`Power counter ${n} (${code})`, `Compteur de puissance ${n} (${code})`);
      }
      return both(`Counter ${n} (${code})`, `Compteur ${n} (${code})`);
    case KINDS.TELEINFO:
      return both(`Teleinformation ${n} (${code})`, `Téléinformation ${n} (${code})`);
    case KINDS.POST:
      return both(`Post ${n} (${code})`, `Poste ${n} (${code})`);
    default:
      return both(`X-THL ${n} (${code})`, `X-THL ${n} (${code})`);
  }
}

/** "Eco-Devices #2 · Relay 3 (R3)" for the Eco-Devices n >= 2 of the configuration; the name alone for the first. */
export const slotName = (slot, name) =>
  slot === 1
    ? name
    : both(`Eco-Devices #${slot} · ${name.en}`, `Eco-Devices n°${slot} · ${name.fr}`);

/** The reason of a failure, in each language. */
export function reasonOf(err) {
  const status = err?.status ? ` (HTTP ${err.status})` : '';
  switch (err?.code) {
    case 'network':
      return both(`no connection (${err.message})`, `pas de connexion (${err.message})`);
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'late':
      return both('no time left to send', 'plus le temps d’envoyer');
    case 'cut':
      return both('interrupted', 'interrompue');
    case 'refused':
      return both(`API key refused${status}`, `clé d’API refusée${status}`);
    case 'busy':
      return both(
        `the Eco-Devices asks to wait${status}`,
        `l’Eco-Devices demande d’attendre${status}`,
      );
    case 'http':
      return both(`unexpected answer${status}`, `réponse inattendue${status}`);
    case 'size':
      return both('answer too large', 'réponse trop grande');
    case 'not_success':
      return both('the Eco-Devices answered an error', 'l’Eco-Devices a répondu une erreur');
    case 'bad_response':
      return both('not an Eco-Devices answer', 'pas une réponse d’Eco-Devices');
    case 'no_product':
      return both(
        'its answer has no "product" field (expected "EcoDevices_RT")',
        'sa réponse n’a pas de champ « product » (attendu « EcoDevices_RT »)',
      );
    case 'wrong_product':
      return both('another GCE product answers', 'un autre produit GCE répond');
    default:
      return both('internal error', 'erreur interne');
  }
}

export const T = {
  noConfig: both(
    'Enter the address of the Eco-Devices RT2 (and its API key unless its protection is off).',
    'Saisissez l’adresse de l’Eco-Devices RT2 (et sa clé d’API sauf si sa protection est désactivée).',
  ),
  addressPath: both(
    'The address must be an IP address or a name, without path nor key (e.g. 192.168.1.50).',
    'L’adresse doit être une adresse IP ou un nom, sans chemin ni clé (par ex. 192.168.1.50).',
  ),
  addressHttps: both(
    'The Eco-Devices is reached over http on your network: remove "https://".',
    'L’Eco-Devices se joint en http sur votre réseau : retirez « https:// ».',
  ),
  addressInvalid: both('The address is not valid.', 'L’adresse n’est pas valide.'),
  apiKeyInvalid: both(
    'The API key is not valid (letters, digits and symbols, no space, 128 characters at most).',
    'La clé d’API n’est pas valide (lettres, chiffres et symboles, sans espace, 128 caractères au plus).',
  ),
  connecting: both('Connecting to the Eco-Devices…', 'Connexion à l’Eco-Devices…'),
  configNotRead: (wait) =>
    both(
      `The configuration could not be read from Gladys: new try in ${wait.en}.`,
      `La configuration n’a pas pu être lue dans Gladys : nouvel essai dans ${wait.fr}.`,
    ),
  connected: (counts) => {
    const parts = (lang) =>
      [
        [counts.relays, 'relay(s)', 'relais'],
        [counts.inputs, 'input(s)', 'entrée(s)'],
        [counts.zones, 'pilot-wire zone(s)', 'zone(s) de fil pilote'],
        [counts.thl, 'X-THL', 'X-THL'],
        [counts.teleinfo, 'teleinformation', 'téléinformation'],
        [counts.posts, 'post(s)', 'poste(s)'],
        [counts.meters, 'index(es)', 'index'],
      ]
        .filter(([n]) => n > 0)
        .map(([n, en, fr]) => `${n} ${lang === 'en' ? en : fr}`)
        .join(', ');
    return both(
      `Connected to the Eco-Devices RT2: ${parts('en') || 'nothing found'}.`,
      `Connecté à l’Eco-Devices RT2 : ${parts('fr') || 'rien trouvé'}.`,
    );
  },
  unreachable: (reason, wait) =>
    both(
      `The Eco-Devices does not answer (${reason.en}): new try in ${wait.en}.`,
      `L’Eco-Devices ne répond pas (${reason.fr}) : nouvel essai dans ${wait.fr}.`,
    ),
  refused: both(
    'The Eco-Devices refused the API key: no read until the key changes or "Test the connection" succeeds.',
    'L’Eco-Devices a refusé la clé d’API : plus de lecture tant que la clé ne change pas ou que « Tester la connexion » n’aboutit pas.',
  ),
  relayErrors: (list) =>
    both(`Relays not understood: ${list.en}.`, `Relais non compris : ${list.fr}.`),
  teleinfoNote: {
    'three-phase': both(
      'Three-phase teleinformation: the current (IINST1-3) is not read by this version.',
      'Téléinformation triphasée : l’intensité (IINST1-3) n’est pas lue par cette version.',
    ),
    'not-historic': both(
      'Teleinformation: no PAPP, IINST nor PTEC understood (standard mode of a Linky?): not read by this version.',
      'Téléinformation : ni PAPP, ni IINST, ni PTEC compris (Linky en mode standard ?) : non lue par cette version.',
    ),
  },
  extensionErrors: (list) =>
    both(`Extensions not understood: ${list.en}.`, `Extensions non comprises : ${list.fr}.`),
  /**
   * One refused entry of "Pulse counters", with what is wrong with it:
   * `{ entry, reason, word, unit }` (src/config.js parseCounters).
   */
  counterError: ({ entry, reason, word, unit }) => {
    const q = (en, fr) => both(`"${entry}": ${en}`, `« ${entry} » : ${fr}`);
    switch (reason) {
      case 'format':
        return q(
          'expected a pulse counter C1 to C12, what it measures and the unit of its index, e.g. "C1:water:l"',
          'attendu un compteur d’impulsions C1 à C12, ce qu’il mesure et l’unité de son index, par ex. « C1:eau:l »',
        );
      case 'number':
        return q(
          'the Eco-Devices RT2 has pulse counters C1 to C12 only',
          'l’Eco-Devices RT2 n’a que les compteurs d’impulsions C1 à C12',
        );
      case 'missingType':
        return q(
          'what it measures is missing (water, gas, electricity), e.g. "C2:gas:m3"',
          'il manque ce qu’il mesure (eau, gaz, électricité), par ex. « C2:gaz:m3 »',
        );
      case 'type':
        return q(
          `"${word}" is not something a counter measures (water, gas, electricity)`,
          `« ${word} » n’est pas ce que mesure un compteur (eau, gaz, électricité)`,
        );
      case 'unit':
        return q(
          `"${unit}" is not a unit of its index (water: l or m3; gas: m3 or l; electricity: wh or kwh)`,
          `« ${unit} » n’est pas une unité de son index (eau : l ou m3 ; gaz : m3 ou l ; électricité : wh ou kwh)`,
        );
      default:
        return q(
          'given twice with different settings, neither kept',
          'donné deux fois avec des réglages différents, aucun gardé',
        );
    }
  },
  counterErrors: (details) =>
    both(
      `Pulse counters not understood: ${listOf(details.map((d) => T.counterError(d).en)).en}.`,
      `Compteurs d’impulsions non compris : ${listOf(details.map((d) => T.counterError(d).fr)).fr}.`,
    ),
  /** One refused entry of "Power counters": `{ entry, reason, word }` (parseClamps). */
  clampError: ({ entry, reason, word }) => {
    const q = (en, fr) => both(`"${entry}": ${en}`, `« ${entry} » : ${fr}`);
    switch (reason) {
      case 'format':
        return q(
          'expected a power counter T1 to T20 and its mode, e.g. "T1" or "T2:production"',
          'attendu un compteur de puissance T1 à T20 et son mode, par ex. « T1 » ou « T2:production »',
        );
      case 'number':
        return q(
          'the Eco-Devices RT2 has power counters T1 to T20 only',
          'l’Eco-Devices RT2 n’a que les compteurs de puissance T1 à T20',
        );
      case 'mode':
        return q(
          `"${word}" is not a mode (consumption, production, injection, drawn); give the name to the device in Gladys`,
          `« ${word} » n’est pas un mode (consommation, production, injection, soutirage) ; donnez le nom à l’appareil dans Gladys`,
        );
      default:
        return q(
          'given twice with different modes, neither kept',
          'donné deux fois avec des modes différents, aucun gardé',
        );
    }
  },
  clampErrors: (details) =>
    both(
      `Power counters not understood: ${listOf(details.map((d) => T.clampError(d).en)).en}.`,
      `Compteurs de puissance non compris : ${listOf(details.map((d) => T.clampError(d).fr)).fr}.`,
    ),
  relaysReadOnly: (count) =>
    count === 1
      ? both(
          '1 relay read only: list it in Configuration → Relays Gladys may drive only if Gladys must drive it (never a pump, a ventilation, a door strike…).',
          '1 relais en lecture seule : listez-le dans Configuration → Relais pilotables par Gladys seulement si Gladys doit le piloter (jamais une pompe, une VMC, une gâche…).',
        )
      : both(
          `${count} relays read only: list in Configuration → Relays Gladys may drive those Gladys must drive (never a pump, a ventilation, a door strike…).`,
          `${count} relais en lecture seule : listez dans Configuration → Relais pilotables par Gladys ceux que Gladys doit piloter (jamais une pompe, une VMC, une gâche…).`,
        ),
  relaysToUpdate: (list) =>
    both(
      `Relays listed, waiting for "Update" in Discover to be driven: ${list.en}.`,
      `Relais listés, en attente de « Mettre à jour » dans Découverte pour être pilotés : ${list.fr}.`,
    ),
  groupsUnread: (groups) => {
    const names = {
      inputs: both('inputs', 'entrées'),
      zones: both('pilot-wire zones', 'zones de fil pilote'),
      thl: both('X-THL', 'X-THL'),
      teleinfo: both('teleinformation', 'téléinformation'),
      posts: both('posts', 'postes'),
      indexes: both('indexes', 'index'),
      tores: both('power counters (Index=T)', 'compteurs de puissance (Index=T)'),
    };
    const list = groups.map((g) => names[g] ?? both(g, g));
    return both(
      `Not read this time (no value published for them): ${list.map((n) => n.en).join(', ')}.`,
      `Non lus cette fois (aucune valeur publiée pour eux) : ${list.map((n) => n.fr).join(', ')}.`,
    );
  },
  held: (list) => {
    const line = (lang) =>
      list
        .slice(0, 5)
        .map(
          (h) =>
            `${shownCode(h.code)} ${number(h.from, lang)} → ${number(h.to, lang)} ${h.unit} (${
              h.direction === 'up'
                ? lang === 'en'
                  ? 'jump'
                  : 'saut'
                : lang === 'en'
                  ? 'drop'
                  : 'baisse'
            })`,
        )
        .join(', ');
    return both(
      `Index held back, not sent to Gladys: ${line('en')}. Check the meter, then click "Accept the held index" twice if the new value is right.`,
      `Index retenu, non envoyé à Gladys : ${line('fr')}. Vérifiez le compteur, puis cliquez deux fois « Accepter l’index retenu » si la nouvelle valeur est juste.`,
    );
  },
  unitChanged: (list) =>
    both(
      `Unit of a counter changed after its index was published, the index is no longer sent (its values would be 1000 times off): ${list.en}. Put the unit back, or delete the device and create it again (its history starts over).`,
      `Unité d’un compteur changée après la publication de son index, l’index n’est plus envoyé (ses valeurs seraient 1000 fois décalées) : ${list.fr}. Remettez l’unité, ou supprimez l’appareil et recréez-le (son historique repart de zéro).`,
    ),
  firmware2: both(
    'This Eco-Devices answers the clamps of firmware 2 (Index_TORE_Cons1): the power counters are not read; update it to firmware 3.',
    'Cet Eco-Devices répond les pinces du firmware 2 (Index_TORE_Cons1) : les compteurs de puissance ne sont pas lus ; mettez-le à jour en firmware 3.',
  ),
  /**
   * The listed meters the answer gives no value for, grouped by why (src/rt2/model.js
   * indexEntry): `Map(why -> [shown codes])`. Nothing is published for them (never 0).
   */
  metersNoValue: (byWhy) => {
    const texts = {
      absent: both(
        'key absent from the Index=all answer (a firmware without power counters? "Read now" shows the keys read)',
        'clé absente de la réponse Index=all (un firmware sans compteurs de puissance ? « Lire maintenant » montre les clés lues)',
      ),
      empty: both(
        'value "--" (a power counter bound to no clamp in the "Compteurs de puissance" page of the RT2, or erased; a pulse counter without a value)',
        'valeur « -- » (compteur de puissance relié à aucune pince dans la page « Compteurs de puissance » du RT2, ou effacé ; compteur d’impulsions sans valeur)',
      ),
      zero: both(
        'value 0 (the counter counted nothing yet: no clamp bound to it, a clamp facing the wrong way — a power counter counts one direction only —, or a mode not matching the clamp; check its index on the page of the RT2)',
        'valeur 0 (le compteur n’a encore rien compté : aucune pince reliée, pince dans le mauvais sens — un compteur de puissance ne compte que dans un sens —, ou mode qui ne correspond pas à la pince ; vérifiez son index sur la page du RT2)',
      ),
      unbound: both(
        'value 4294967295 (an entry with nothing behind it)',
        'valeur 4294967295 (une entrée sans rien derrière)',
      ),
      unreadable: both(
        'value not understood (not a positive number)',
        'valeur non comprise (pas un nombre positif)',
      ),
    };
    const parts = (lang) =>
      [...byWhy]
        .map(
          ([why, codes]) =>
            `${listOf(codes)[lang]}${lang === 'fr' ? ' : ' : ': '}${(texts[why] ?? texts.unreadable)[lang]}`,
        )
        .join(lang === 'fr' ? ' ; ' : '; ');
    return both(
      `Index(es) listed but without a value, nothing published for them: ${parts('en')}.`,
      `Index listé(s) mais sans valeur, rien n’est publié pour eux : ${parts('fr')}.`,
    );
  },
  toreCommand: both(
    'The power counters are not in Index=all on this Eco-Devices: read with Index=T instead.',
    'Les compteurs de puissance ne sont pas dans Index=all sur cet Eco-Devices : lus par Index=T à la place.',
  ),
  clampsUnlisted: (list) =>
    both(
      `Power counter(s) counting but not listed in Configuration → Power counters: ${list.en}. List them with their mode to bring them in.`,
      `Compteur(s) de puissance qui comptent mais ne sont pas listés dans Configuration → Compteurs de puissance : ${list.fr}. Listez-les avec leur mode pour les amener.`,
    ),
  zonesNumeric: (list) =>
    both(
      `Pilot-wire zone(s) answering no known mode (a number, nothing or an unknown text; no X-4FP there?): ${list.en}. Not published; Eco and Comfort refused there until a mode is read, Off and Frost protection still sent.`,
      `Zone(s) de fil pilote qui ne répondent aucun mode connu (un nombre, rien ou un texte inconnu ; pas de X-4FP ?) : ${list.fr}. Non publiée(s) ; Éco et Confort y sont refusés tant qu’aucun mode n’est lu, Arrêt et Hors-gel restent envoyés.`,
    ),
  guardsPending: (list) =>
    both(
      `Off / Frost protection not applied yet, sent again: ${list.en}.`,
      `Arrêt / Hors-gel pas encore appliqué, renvoyé : ${list.fr}.`,
    ),
  guardsUnconfirmable: (list) =>
    both(
      `Off / Frost protection sent, cannot be confirmed (the zone answers no mode): ${list.en}.`,
      `Arrêt / Hors-gel envoyé, impossible à confirmer (la zone ne répond aucun mode) : ${list.fr}.`,
    ),
  guardsFailed: (list) =>
    both(
      `Off / Frost protection not applied after 3 tries, check on site: ${list.en}.`,
      `Arrêt / Hors-gel non appliqué après 3 essais, vérifiez sur place : ${list.fr}.`,
    ),
  notApplied: (list) =>
    both(
      `Last command not applied (read back differs): ${list.en}.`,
      `Dernière commande non appliquée (la relecture diffère) : ${list.fr}.`,
    ),
  pendingDropped: (list) =>
    both(
      `Off clicked before the configuration was read, not sent (relay not listed or output unknown): ${list.en}.`,
      `Arrêt cliqué avant la lecture de la configuration, non envoyé (relais non listé ou sortie inconnue) : ${list.fr}.`,
    ),
  storeProblem: both(
    'The state cannot be written to /data: heating modes refused and no index sent until it can.',
    'L’état ne peut pas être écrit dans /data : modes de chauffe refusés et aucun index envoyé tant que c’est le cas.',
  ),
  wrongProductReason: (product) =>
    both(`another GCE product answers (${product})`, `un autre produit GCE répond (${product})`),
  wrongProduct: (product) =>
    both(
      `The device at this address is not an Eco-Devices RT2 (it answers as "${product}"): check the address (nothing is sent nor published meanwhile, not even an Off).`,
      `L’appareil à cette adresse n’est pas un Eco-Devices RT2 (il répond comme « ${product} ») : vérifiez l’adresse (rien n’est envoyé ni publié d’ici là, pas même un Arrêt).`,
    ),
  otherBox: (slot) =>
    both(
      `The devices of Eco-Devices #${slot} were created for the Eco-Devices at another address (or port): none of their commands is sent, their Offs kept are dropped. Put back the address of their Eco-Devices (another Eco-Devices goes in its own slot, see the guide), or, if it only moved to this address, click "Attach the devices" twice.`,
      `Les appareils de l’Eco-Devices n°${slot} ont été créés pour l’Eco-Devices d’une autre adresse (ou d’un autre port) : aucune de leurs commandes n’est envoyée, leurs arrêts gardés sont abandonnés. Remettez l’adresse de leur Eco-Devices (un autre Eco-Devices va dans son propre emplacement, voir le guide), ou, s’il a seulement changé d’adresse, cliquez deux fois « Rattacher les appareils ».`,
    ),
  notAttached: (slot) =>
    both(
      `The devices of Eco-Devices #${slot} are not known to belong to the Eco-Devices read (the state in /data was lost): only Off and Frost protection are sent, to the address typed; no other command, no value until you click "Attach the devices" twice (if they are its own).`,
      `Rien ne dit que les appareils de l’Eco-Devices n°${slot} appartiennent à l’Eco-Devices lu (l’état de /data a été perdu) : seuls Arrêt et Hors-gel sont envoyés, à l’adresse saisie ; aucune autre commande, aucune valeur tant que vous n’avez pas cliqué deux fois « Rattacher les appareils » (si ce sont les siens).`,
    ),
  ownerUnwritable: both(
    'The state cannot be written to /data and holds nothing yet: which Eco-Devices the devices belong to is unknown. Only Off and Frost protection are sent, to the address typed, until /data can be written.',
    'L’état ne peut pas être écrit dans /data, qui ne contient encore rien : on ne sait pas à quel Eco-Devices appartiennent les appareils. Seuls Arrêt et Hors-gel sont envoyés, à l’adresse saisie, tant que /data ne peut pas être écrit.',
  ),
  duplicateSlot: (other) =>
    both(
      `Same address as Eco-Devices #${other}: an Eco-Devices goes in one slot only. This one is not read; empty its address.`,
      `Même adresse que l’Eco-Devices n°${other} : un Eco-Devices ne va que dans un emplacement. Celui-ci n’est pas lu ; videz son adresse.`,
    ),
  ownerUnreadable: both(
    'The state in /data cannot be read: which Eco-Devices the devices belong to is unknown, only Off and Frost protection are sent until it can, and no index is published.',
    'L’état de /data ne peut pas être lu : on ne sait pas à quel Eco-Devices appartiennent les appareils, seuls Arrêt et Hors-gel sont envoyés d’ici là, et aucun index n’est publié.',
  ),
  attach: {
    notRead: both(
      'No Eco-Devices read right now: click "Test the connection" first.',
      'Aucun Eco-Devices lu en ce moment : cliquez d’abord « Tester la connexion ».',
    ),
    already: (slot) =>
      both(
        `The devices of Eco-Devices #${slot} already belong to the Eco-Devices read: nothing to do.`,
        `Les appareils de l’Eco-Devices n°${slot} appartiennent déjà à l’Eco-Devices lu : rien à faire.`,
      ),
    confirm: (slot, count) =>
      both(
        `Click again within a minute to attach the ${count} device(s) of Eco-Devices #${slot} to the Eco-Devices read now at this address: its relays listed in the configuration will obey them.`,
        `Cliquez à nouveau dans la minute pour rattacher les ${count} appareil(s) de l’Eco-Devices n°${slot} à l’Eco-Devices lu en ce moment à cette adresse : ses relais listés dans la configuration leur obéiront.`,
      ),
    done: (slot, count) =>
      both(
        `Done: the ${count} device(s) of Eco-Devices #${slot} belong to the Eco-Devices read.`,
        `C’est fait : les ${count} appareil(s) de l’Eco-Devices n°${slot} appartiennent à l’Eco-Devices lu.`,
      ),
    noSlot: both(
      'Choose an Eco-Devices of the configuration.',
      'Choisissez un Eco-Devices de la configuration.',
    ),
  },
  accept: {
    nothing: both(
      'No index is held back: nothing to accept.',
      'Aucun index n’est retenu : rien à accepter.',
    ),
    confirm: (list) => {
      const line = (lang) =>
        list
          .slice(0, 5)
          .map(
            (h) => `${shownCode(h.code)} ${number(h.from, lang)} → ${number(h.to, lang)} ${h.unit}`,
          )
          .join(', ');
      return both(
        `Held back: ${line('en')}. Check these values on the meters, then click again between 3 s and 5 min from now to send them to Gladys (a jump is then counted as consumption once).`,
        `Retenus : ${line('fr')}. Vérifiez ces valeurs sur les compteurs, puis cliquez à nouveau entre 3 s et 5 min d’ici pour les envoyer à Gladys (un saut est alors compté une fois comme consommation).`,
      );
    },
    done: (accepted, changed) => {
      const codes = (entries) => entries.map((h) => shownCode(h.code)).join(', ');
      const parts = [];
      if (accepted.length > 0) {
        parts.push(
          both(
            `Accepted, sent at the next read: ${codes(accepted)}.`,
            `Accepté, envoyé à la prochaine lecture : ${codes(accepted)}.`,
          ),
        );
      }
      if (changed.length > 0) {
        parts.push(
          both(
            `Changed since the first click, not accepted (click twice again): ${codes(changed)}.`,
            `Changé depuis le premier clic, non accepté (cliquez de nouveau deux fois) : ${codes(changed)}.`,
          ),
        );
      }
      return join(...parts);
    },
  },
  readNow: {
    paused: (wait) =>
      both(
        `The Eco-Devices asked to wait, or the last reads failed: no read before ${wait.en}.`,
        `L’Eco-Devices a demandé d’attendre, ou les dernières lectures ont échoué : pas de lecture avant ${wait.fr}.`,
      ),
    joined: both(
      'A read was already running: here is what it gave.',
      'Une lecture était déjà en cours : voici ce qu’elle a donné.',
    ),
    unread: both(
      'The indexes (Index=all) were not read this time.',
      'Les index (Index=all) n’ont pas été lus cette fois.',
    ),
    none: both(
      'No pulse counter nor power counter listed in the configuration.',
      'Aucun compteur d’impulsions ni compteur de puissance listé dans la configuration.',
    ),
    /** One listed meter: its key, the raw value read and what became of it. */
    line: ({ shown, key, raw, why, value, unit }) => {
      const rawText = raw === undefined ? '' : String(raw).slice(0, 24);
      const whys = {
        absent: both('key absent from the answer', 'clé absente de la réponse'),
        empty: both('no value ("--")', 'pas de valeur (« -- »)'),
        zero: both('0, counts nothing yet', '0, ne compte encore rien'),
        unbound: both('4294967295, nothing behind it', '4294967295, rien derrière'),
        unreadable: both('not understood', 'non compris'),
      };
      if (why === 'absent')
        return both(`${shown}: ${whys.absent.en}`, `${shown} : ${whys.absent.fr}`);
      if (why) {
        return both(
          `${shown} (${key}): ${whys[why].en} [${rawText}]`,
          `${shown} (${key}) : ${whys[why].fr} [${rawText}]`,
        );
      }
      return both(
        `${shown} (${key}): ${rawText} read, ${number(value, 'en')} ${unit} published`,
        `${shown} (${key}) : ${rawText} lu, ${number(value, 'fr')} ${unit} publié`,
      );
    },
  },
  test: {
    busy: both(
      'A read is already running: try again in a moment.',
      'Une lecture est déjà en cours : réessayez dans un instant.',
    ),
    wait: (wait) =>
      both(
        `The Eco-Devices was read less than an interval ago: next read in ${wait.en}.`,
        `L’Eco-Devices a été lu il y a moins d’un intervalle : prochaine lecture dans ${wait.fr}.`,
      ),
    slow: both(
      'The Eco-Devices is slow to answer: see the status in a moment.',
      'L’Eco-Devices tarde à répondre : voyez l’état dans un instant.',
    ),
  },
};

/** The refusals of a command (the message of the error Gladys shows). */
export const ERRORS = {
  readOnly: both(
    'This relay is read only: add it to "Relays Gladys may drive" to drive it. Nothing was sent.',
    'Ce relais est en lecture seule : ajoutez-le à « Relais pilotables par Gladys » pour le piloter. Rien n’a été envoyé.',
  ),
  notCommandable: both(
    'This feature is read only: nothing was sent.',
    'Cette fonctionnalité est en lecture seule : rien n’a été envoyé.',
  ),
  zoneNumeric: both(
    'This zone answers no known mode (a number, nothing or an unknown text; no X-4FP there?): Eco and Comfort are refused until a mode is read, nothing was sent.',
    'Cette zone ne répond aucun mode connu (un nombre, rien ou un texte inconnu ; pas de X-4FP ?) : Éco et Confort sont refusés tant qu’aucun mode n’est lu, rien n’a été envoyé.',
  ),
  heatingDisabled: both(
    'Heating modes (Comfort, Eco) are off in the configuration: nothing was sent. Off and Frost protection need no option.',
    'Les modes de chauffe (Confort, Éco) sont désactivés dans la configuration : rien n’a été envoyé. Arrêt et Hors-gel n’ont besoin d’aucune option.',
  ),
  badValue: both(
    'This value is not valid: nothing was sent.',
    'Cette valeur n’est pas valide : rien n’a été envoyé.',
  ),
  configNotLoaded: both(
    'The configuration is not read yet: nothing was sent.',
    'La configuration n’est pas encore lue : rien n’a été envoyé.',
  ),
  noConfig: both(
    'The address of the Eco-Devices is missing or not valid: nothing was sent.',
    'L’adresse de l’Eco-Devices manque ou n’est pas valide : rien n’a été envoyé.',
  ),
  unknownTarget: both(
    'This output is not known on the Eco-Devices (a zone must be listed in Extensions): nothing was sent.',
    'Cette sortie n’est pas connue sur l’Eco-Devices (une zone doit être listée dans Extensions) : rien n’a été envoyé.',
  ),
  paused: (reason) =>
    both(
      `The Eco-Devices does not answer (${reason.en}): nothing was sent.`,
      `L’Eco-Devices ne répond pas (${reason.fr}) : rien n’a été envoyé.`,
    ),
  keyRefused: both(
    'The Eco-Devices refused the API key: nothing was sent.',
    'L’Eco-Devices a refusé la clé d’API : rien n’a été envoyé.',
  ),
  stopPending: both(
    'An Off / Frost protection is being sent to this zone: nothing was sent.',
    'Un Arrêt / Hors-gel est en cours d’envoi sur cette zone : rien n’a été envoyé.',
  ),
  cancelledByStop: both(
    'Cancelled by a later Off / Frost protection / switch-off: nothing was sent.',
    'Annulée par un Arrêt / Hors-gel / une extinction plus récent : rien n’a été envoyé.',
  ),
  queueFull: both(
    'Too many commands waiting: nothing was sent.',
    'Trop de commandes en attente : rien n’a été envoyé.',
  ),
  late: (ahead) =>
    ahead > 0
      ? both(
          `The Eco-Devices was too slow (${ahead} command(s) before this one): nothing was sent.`,
          `L’Eco-Devices a été trop lent (${ahead} commande(s) avant celle-ci) : rien n’a été envoyé.`,
        )
      : both(
          'The Eco-Devices was too slow: nothing was sent.',
          'L’Eco-Devices a été trop lent : rien n’a été envoyé.',
        ),
  notSent: (reason) =>
    both(
      `Not sent (${reason.en}): nothing was sent.`,
      `Non envoyée (${reason.fr}) : rien n’a été envoyé.`,
    ),
  cut: both(
    'Interrupted by an Off / Frost protection / switch-off: nothing was sent.',
    'Interrompue par un Arrêt / Hors-gel / une extinction : rien n’a été envoyé.',
  ),
  unconfirmed: both(
    'Sent, without confirmation: the Eco-Devices is read again in a few seconds.',
    'Envoyée, sans confirmation : l’Eco-Devices est relu dans quelques secondes.',
  ),
  unconfirmable: both(
    'Sent, cannot be confirmed: this zone answers no known mode (no X-4FP there?), no read can show it.',
    'Envoyée, impossible à confirmer : cette zone ne répond aucun mode connu (pas de X-4FP ?), aucune lecture ne peut le montrer.',
  ),
  rejected: both(
    'Sent, but the Eco-Devices answered an error: it is read again in a few seconds.',
    'Envoyée, mais l’Eco-Devices a répondu une erreur : il est relu dans quelques secondes.',
  ),
  notApplied: (read, wanted) =>
    both(
      `Sent, but the Eco-Devices reads ${read.en} (asked: ${wanted.en}): not applied yet, read again in a few seconds.`,
      `Envoyée, mais l’Eco-Devices lit ${read.fr} (demandé : ${wanted.fr}) : pas encore appliquée, relue dans quelques secondes.`,
    ),
  otherBox: (slot) =>
    both(
      `This device was created for the Eco-Devices at another address (Eco-Devices #${slot}): nothing was sent.`,
      `Cet appareil a été créé pour l’Eco-Devices d’une autre adresse (Eco-Devices n°${slot}) : rien n’a été envoyé.`,
    ),
  wrongProduct: both(
    'The device at this address is not an Eco-Devices RT2: nothing was sent.',
    'L’appareil à cette adresse n’est pas un Eco-Devices RT2 : rien n’a été envoyé.',
  ),
  notAttached: (slot) =>
    both(
      `It is not known that this device belongs to the Eco-Devices read (Eco-Devices #${slot}, see its status and "Attach the devices"): nothing was sent (Off and Frost protection still are).`,
      `Rien ne dit que cet appareil appartient à l’Eco-Devices lu (Eco-Devices n°${slot}, voir son état et « Rattacher les appareils ») : rien n’a été envoyé (Arrêt et Hors-gel le sont quand même).`,
    ),
  saveFailed: both(
    'The state could not be written to /data: nothing was sent.',
    'L’état n’a pas pu être écrit dans /data : rien n’a été envoyé.',
  ),
  keptUntilConfig: both(
    'Not sent yet: the configuration is being read from Gladys; kept and sent as soon as it is read.',
    'Pas encore envoyée : la configuration est en cours de lecture dans Gladys ; gardée et envoyée dès sa lecture.',
  ),
  protectiveKeptRefused: both(
    'The Eco-Devices refused the API key: the Off is kept, and sent again as soon as a new key is saved or "Test the connection" succeeds.',
    'L’Eco-Devices a refusé la clé d’API : l’arrêt est gardé, et renvoyé dès qu’une nouvelle clé est enregistrée ou que « Tester la connexion » aboutit.',
  ),
  sentToOther: (product) =>
    both(
      `Sent, but another GCE product answered ("${product}"), not an Eco-Devices RT2: nothing more is sent to this address until an Eco-Devices RT2 answers there.`,
      `Envoyée, mais un autre produit GCE a répondu (« ${product} »), pas un Eco-Devices RT2 : plus rien n’est envoyé à cette adresse tant qu’un Eco-Devices RT2 n’y répond pas.`,
    ),
  ownerUnknown: both(
    '/data cannot be read or written: which Eco-Devices this device belongs to is unknown, only Off and Frost protection are sent. Nothing was sent.',
    '/data ne peut être ni lu ni écrit : on ne sait pas à quel Eco-Devices appartient cet appareil, seuls Arrêt et Hors-gel sont envoyés. Rien n’a été envoyé.',
  ),
  protectiveKept: (reason) =>
    both(
      `Not sent yet (${reason.en}): kept and sent again as soon as the Eco-Devices is free.`,
      `Pas encore envoyée (${reason.fr}) : gardée et renvoyée dès que l’Eco-Devices est libre.`,
    ),
};
