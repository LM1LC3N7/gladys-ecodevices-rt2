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
};

/** The code as the user types it: `R3`, `FP5`, `TORE2`. */
export const shownCode = (code) => code.toUpperCase();

/** The name of a target in Gladys: "Relay 3 (R3)", "Clamp 2 (TORE2)". */
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
        return both(`Clamp ${n} (${code})`, `Pince ${n} (${code})`);
      }
      return both(`Counter ${n} (${code})`, `Compteur ${n} (${code})`);
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
  extensionErrors: (list) =>
    both(`Extensions not understood: ${list.en}.`, `Extensions non comprises : ${list.fr}.`),
  counterErrors: (list) =>
    both(`Counters not understood: ${list.en}.`, `Compteurs non compris : ${list.fr}.`),
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
      indexes: both('indexes', 'index'),
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
  guardsPending: (list) =>
    both(
      `Off / Frost protection not applied yet, sent again: ${list.en}.`,
      `Arrêt / Hors-gel pas encore appliqué, renvoyé : ${list.fr}.`,
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
      `The devices of Eco-Devices #${slot} are not known to belong to the Eco-Devices read (the state in /data was lost): none of their commands is sent. If they are its own, click "Attach the devices" twice.`,
      `Rien ne dit que les appareils de l’Eco-Devices n°${slot} appartiennent à l’Eco-Devices lu (l’état de /data a été perdu) : aucune de leurs commandes n’est envoyée. Si ce sont les siens, cliquez deux fois « Rattacher les appareils ».`,
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
      `It is not known that this device belongs to the Eco-Devices read (Eco-Devices #${slot}, see its status): nothing was sent.`,
      `Rien ne dit que cet appareil appartient à l’Eco-Devices lu (Eco-Devices n°${slot}, voir son état) : rien n’a été envoyé.`,
    ),
  saveFailed: both(
    'The state could not be written to /data: nothing was sent.',
    'L’état n’a pas pu être écrit dans /data : rien n’a été envoyé.',
  ),
  keptUntilConfig: both(
    'Not sent yet: the configuration is being read from Gladys; kept and sent as soon as it is read.',
    'Pas encore envoyée : la configuration est en cours de lecture dans Gladys ; gardée et envoyée dès sa lecture.',
  ),
  protectiveKept: (reason) =>
    both(
      `Not sent yet (${reason.en}): kept and sent again as soon as the Eco-Devices is free.`,
      `Pas encore envoyée (${reason.fr}) : gardée et renvoyée dès que l’Eco-Devices est libre.`,
    ),
};
