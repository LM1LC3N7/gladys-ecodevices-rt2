# TODO - Eco-Devices RT2

Handoff document: what is done, what was decided, what comes next. Keep it up
to date at the end of every milestone.

## Status

- [x] **Milestone 1** (2026-10-30): up to three Eco-Devices RT2 through the
      local JSON API; indexes (teleinformation TI1-TI7, clamps TORE1-TORE16,
      pulse counters C1-C12 as configured) through the index guard; relays
      R1-R10 (read only unless listed), inputs D1-D12, X-4FP zones FP1-FP8
      (Off / Frost protection protective, Eco / Comfort behind
      `allow_heating_modes`), X-THL 1-2; guards of the protective commands in
      `/data`; identity by address and port; "Test the connection", "Accept
      the held index", "Attach the devices"; fr/en docs. Tested against an
      in-memory Eco-Devices on a virtual clock, and a real local HTTP server
      on a real clock (x20). Reserved at #436 of thread 10385 for cce66
      (t/11448), who has the boxes and will test.
- [x] **Review r1** (2026-10-30): REFUSÉ, 4 important, 5 minor; fixed (see
      "Decisions after the review r1").
- [x] **Review r2** (same reviewer): approved, released as 0.1.1.
- [x] **First real answers** (cce66, t/11448 #7, 2026-10-31): `Get=R`,
      `Index=all`, `Get=FP` of his RT2, and the index of his Eco-Devices 3 on
      the same Linky (copy in `_lots/hors-lot/cce66-n7/releves.md`, tests in
      `test/cce66.test.js`). Fixed from them (2026-11-01): see "Decisions
      after the first real answers".
- [x] **Second real answers** (cce66, t/11448 #9, 2026-11-02; copy in
      `_lots/hors-lot/cce66-n9/releves.md`): firmware 3.00.04; clamps 1-16
      real, TORE17+ an X400 CT left over; no X-4FP, X-THL nor inputs wired
      yet. Applied in 0.1.3 (see "Decisions after the second real answers").
- [ ] **First real run** (cce66): the integration itself on his RT2; until
      then the docs and the manifest say "never tested with a real device".
- [ ] **Milestone 2**: instant power of the posts (`Get=P`; none per clamp
      in `xdevices.json`, see the decisions of 2026-11-03), posts and
      sub-posts (`Index=P|S`), teleinformation details (`Get=TI`: current
      tariff, apparent power), virtual outputs (`Get=VO`), EnOcean (`Get=XENO`:
      actuators behind the same rules as the relays), prices.
- [ ] **Release**: `gi ci`, Release workflow, topic (only after the review).

## Questions pour cce66

Answered on 2026-10-31 (t/11448 #7):

- [x] `Get=R`: `R1`..`R10`, numbers 0/1, with `"product": "EcoDevices_RT"`
      and `"status": "Success"` (nothing to relax). He sees 10 relays and
      12 inputs.
- [x] `Index=all`: keys `Index_TI1`..`7`, `Index_TORE1`..`20` (not 16),
      `Index_C1`..`12`. TI3 to TI7 read 4294967295 (no entry). Teleinformation
      in Wh (see the Decisions below); clamps not settled.
- [x] `Get=FP`: keys `FP1 Zone 1`..`FP2 Zone 4`, values the **number** 0,
      not a text.
- [x] Firmware: 3.00.04 (2026-11-02; his ED3 is 1.3.0, his IPX800 V5
      5.7.2).

Answered on 2026-11-02 (t/11448 #9): `Index_TORE<n>` is the energy counted
on clamp n, the page shows only the instant power (no unit to compare);
clamps 17-20+ are an X400 CT left over (frozen); no X-4FP yet (he will wire
one); `Get=D` / `Get=XTHL`: nothing wired yet; firmware 3.00.04.

Still open, to ask on the forum (short, in French):

1. Pinces (unité de l'index) : deux relevés de `Index=all` à une heure
   d'écart (heure notée), et pendant cette heure la puissance moyenne de la
   pince 1 sur la page (ou un appareil de puissance connue et stable seul sur
   cette pince : un radiateur de 1500 W, par exemple). Écart d'index ≈ 1500
   par heure : Wh ; ≈ 1,5 : kWh ; ≈ 1 500 000 : mWh.
2. Fil pilote, quand le X-4FP sera câblé : `Get=FP` complet ; que montre la
   page pour la zone 1 ; change un mode depuis la page, puis renvoie
   `Get=FP` : texte ou nombre ?
3. `Get=D` et `Get=XTHL` quand ils seront câblés : la réponse complète.
4. Une mauvaise clé d'API : que répond `Get=R` (401, ou une page, ou
   `"status": "Error"`) ?
5. Avec l'intégration lancée : tout va bien à 15 s (cinq requêtes par
   lecture), la page de l'Eco-Devices reste fluide ?

## Decisions

- **Version 0.1.0, set by hand once** in `package.json`, `package-lock.json`,
  the manifest `version` and the `docker_image` tag; every later version
  comes from Actions > Release.
- **SDK 0.16.0** (the latest on npm on 2026-10-30, `^0.16.0`).
  `gladys_version: ">=5.1.0"`; categories energy, climate, lighting;
  `keywords` and `countries` (FR) wait until Gladys 5.3 is widespread.
- **Sources**: the GCE PDF "API Eco Devices RT" (01/02/2017, the
  manufacturer's command list), cce66's `GCE_EDRT2_Api-Deck v1.html`
  (commit e76f2b3, MIT, a tester written by a user: facts only), and
  pyecodevices_rt2 1.3.4 (MIT) for the keys of the answers; the Home
  Assistant integration ecodevices_rt2 2.2.10 (Apache-2.0) for the meaning
  and default units. Cloned read only in `~/code/ref/gce/` (with the PDF).
  Confirmed by two of them: the path and `key`, `Get=R|D|FP`, `Index=all`,
  `SetR` / `ClearR` 01-10, `SetFPxx` 00-08 and the mode codes, 10 relays,
  12 inputs, 16 clamps (20 on a real RT2), 12 counters, 7 teleinformation
  indexes, 2 X-THL.
  The rest is in "Questions pour cce66".
- **Structure from gladys-ipx800 0.1.3** (same API family as the IPX800 V4,
  reviewed in four rounds and tested by cce66 on a V4 and a V5): the lane of
  requests and its priorities, the protective commands and their guards, the
  commands and their confirmation, the slots, Discover only from what is
  read. The V5 parts, the MAC identity, the 0.1.2 migration and the "wrong
  model" probe were removed.
- **Reads**: `Get=R` first (the round fails without it: identity of the
  answer, relays), then `Get=D`, `Get=FP` (zones listed), `Get=XTHL` (X-THL
  listed), `Index=all`; a secondary group failing (not on a cut or a 429 / 503) leaves its targets without value, said in the status. The combined
  `Get=R|D|FP` of the GCE PDF is not used (one source, "use sparingly").
- **Envelope**: a `product` other than `EcoDevices_RT` is another GCE product
  (status "not an Eco-Devices RT2", pause, Discover empty, nothing sent, not
  even an Off; kept in `/data` for that address, so that a restart sends no
  kept Off to it before a round reads an RT2 there; an outage of that box
  does not lift it); an
  answer without `product` is taken when it says `"status": "Success"`, one
  with neither is not an answer.
- **Identity**: the API gives no MAC address (GCE PDF: `configmac` only in
  `status.json`, behind the user / admin password): the owner of a slot is
  its controller key (hash of the address and port), set at the first round
  of a slot without devices. Another address: nothing sent nor published,
  Offs dropped, Discover empty, "Attach the devices" (two clicks within a
  minute). Known limit, in the docs: another RT2 at the same address and
  port is taken for the same one.
- **Relays read only by default**; `relays` lists those Gladys may drive
  (`R1`, `R2:light`), with the "turn everything off" warning in the
  manifest, the status and the docs. All 10 relays and 12 inputs are listed
  in Discover (the API answers them all); zones and X-THL only when listed in
  `extensions`.
- **Pilot wire**: Off and Frost protection protective (as the IPX800); Eco
  and Comfort behind `allow_heating_modes`; `SetFP00` (every zone) is never
  built nor accepted by the client; zones 1-8 only (two X-4FP: the `SetFP`
  range of the GCE PDF), although `Get=FP` answers 16. A guard of a zone no
  longer listed is dropped like one of a relay no longer listed.
- **Indexes**: one Gladys device per index (`ti<n>`, `tore<n>`, `c<n>`).
  Teleinformation and clamps: `energy-sensor/index` in kWh, read in Wh
  (divided by 1000: confirmed for the teleinformation on 2026-10-31, the
  clamps still to confirm); listed when above 0 or created. Counters: only those in `counters`
  (`C1:water:l`): water and gas `volume-sensor/decimal` in m³ (never an
  energy index), electricity `energy-sensor/index` in kWh; the feature key is
  the type (`water-index`, `gas-index`, `energy-index`): another type adds a
  feature, with its own reference.
- **Index guard** (`src/guard.js` of gladys-ecodevices 0.1.2, approved):
  never 0, never lower, a jump beyond 100 kW (electricity), 10 m³/h (water),
  16 m³/h (gas) plus a slack held; the held value and the reference in
  `/data` with the Gladys device id (a device created again starts afresh, a
  deleted one takes its state with it); /data written before any index is
  sent (a save that fails sends none, /data unreadable sends none). Dates on
  the session clock (wall at the start + monotonic since). "Accept the held
  index": two clicks 3 s to 5 min apart in the same session, only the
  entries listed by the first click and unchanged since (same `from`, same
  threshold for a jump, `to` within the margin). Jumps **and drops** are
  accepted that way: these indexes are registers of the meter or of the
  Eco-Devices, never a total built here (rule of the fiche on built
  indexes), and a replaced meter needs a way out that keeps the history; the
  core skips the negative delta of a drop.
- **Not in milestone 1**: instant power (`Get=P|S`), posts, prices, virtual
  outputs, EnOcean, `Get=TI` (current tariff): see Milestone 2.
- **API key optional**: the protection can be turned off in the Eco-Devices
  (GCE PDF); empty, no `key` parameter is sent.
- **Pace**: 15 s by default (as the Home Assistant integration), 5 to 300.

## Decisions after the review r1 (2026-10-30)

- **I1, another product at the address**: `product` is required in every
  answer. Every write waits for a `Get=R` that left after its click (or
  250 ms before it: one read for the clicks of a scene) and showed
  `EcoDevices_RT`; a command within its 3.5 s (no answer: "nothing was
  sent"); an Off, a Frost protection and a resend of a guard 1 s at most,
  then they leave anyway (unreadable is never "another product"); a resend
  takes a proof up to 1 s old. Any answer naming another product (round,
  secondary group, read back, follow-up, write) marks it at once, in memory
  and in `/data` for that address: no command, no Off, nothing published,
  Discover empty, the waiting commands refused, until a round reads an RT2
  there; an outage of that box does not lift it. A write answered by another
  product acks "sent, but another GCE product answered". Cost: one more
  request per burst of clicks (the clicks within 250 ms of a read share it),
  not per click (a scene of 5 at 600 ms a request passes, 700 ms not:
  the last one "too slow", nothing sent). Found on the way: two clicked Offs
  queued together (after the shared product read) did not get the 1 s
  "stuck" cut of the first; the lane now arms it when the first one starts.
- **I2, /data never writable** (as gladys-ipx800 7786d42): no file, devices
  there, and the first save of the start failing: the owner is unknown, as
  with an unreadable file: Offs to the address typed, nothing else, no index,
  "Attach" refused (kept nowhere), a status. A file lost but writable keeps
  the choice of the IPX800: nothing until "Attach", which is then kept.
- **I3, TI and TORE units**: neither offered nor published until cce66
  confirms (question 5); the status counts those read. Counters: the unit is
  kept with the index state; a unit changed after the index was published
  stops that index for good (status), until the unit is put back or the
  device created again: a factor 1000 can never become an accepted jump.
- **I4, /data that never answers**: every read and write of `/data` is
  bounded (2 s, a failure then); the file store merges the saves waiting
  behind a write into one (the 16 latest waiters, the older told it failed):
  the rounds go on, the status says "/data", no index, the test button
  answers.
- **m1**: one address in two slots: the second is not read, a status (from
  gladys-ipx800 7786d42). **m2**: an id of a slot this version does not have
  (`rt24:`...) gets a plain refusal. **m3**: an Off answered 401 says it is
  kept and sent again with the new key. **m4**: a test per surviving mutant
  (`test/guards.test.js`). **m5**: manifest, README and guides.

## Decisions after the review r2 (2026-10-30)

- **I5 (rule I-4 of the ED3 r2)**: no owner known and devices there, /data
  writable (a file deleted or emptied, Gladys restored on a new machine):
  Off and Frost protection go to the address typed (the identity of an RT2
  is its address, nothing proves another box); On, Eco, Comfort and the
  values wait for "Attach the devices"; the status says so. Refused only on
  proof: another product (the product read), a slot with the address of
  another one (never read).
- **m1**: tests for R12 (the 250 ms tolerance), R24 (a failed product read
  refuses the command) and X4 (the generation of the first click).
- **m2**: a write answered `"status": "Success"` without `product` is taken
  (the product was just proven by the read before it, the read back
  confirms); another `product` still stops everything. A read without
  `product` fails with its own reason, said in the status ("its answer has
  no product field"), for cce66 to report.
- Scenes on one slow RT2 (review r2, p-scene): 5/5 at 650 ms a request, 4/5
  at 700 ms, 3/5 at 900 ms (the last ones "too slow", nothing sent; Offs
  all go): accepted (one box, one request at a time, 3.5 s budget).

## Decisions after the first real answers (2026-11-01)

- **4294967295 (0xFFFFFFFF) is an entry with nothing behind it**, never an
  index (TI3 to TI7 on cce66's RT2): `indexNumber` gives undefined for it,
  any index kind; never offered, published, nor held as a jump (an index
  turning to it keeps the last one in Gladys, nothing held; back to a real
  value, published from the same reference).
- **Teleinformation in Wh, confirmed (`UNIT_CONFIRMED.ti`)**: his RT2 read
  `Index_TI1` = 132,533,718 and his Eco-Devices 3, on the same Linky a few
  minutes apart, 132,533,861 (Wh, the ED3 unit): 143 Wh apart, the same
  meter. In kWh it would be 132 GWh, no home; 132,533 kWh over the years of
  a Linky is a home. His "unité téléinfo KWH" is the unit his page shows
  (divided by 1000). The TI indexes are now offered (above 0) and published
  in kWh; the factor of `meterOf` was already Wh.
- **Clamps not confirmed (`UNIT_CONFIRMED.tore` false)**: split from the
  teleinformation (one flag each). His "Pinces en mA affichage en W" speaks
  of the instant measure, not the index; no index compared with the page
  yet (question 1). Read up to `Index_TORE20` (`LIMITS_RT2.tore` 20: the
  GCE PDF said 16, his RT2 answers 20, TORE17, 18, 20 above 0) and counted
  in the status only.
- **Pilot wire: a number is not understood**: his `Get=FP` answers the
  number 0 for the 8 zones. pyecodevices_rt2 (the only source on it) maps a
  0 to -1, "unknown", and its own live test accepts -1 for a zone; the modes
  are texts there (`Confort`..`Confort -2`) and the GCE PDF only gives the
  codes of `SetFPxx` (0 = Comfort for a write). So 0 is most likely "no
  X-4FP", but a firmware answering the mode codes as numbers (0 = Comfort)
  cannot be ruled out: a number is never published nor taken for a mode.
  A zone whose last read is a number is listed in the status; Eco and
  Comfort (and Comfort -1, -2) are refused there before anything leaves
  (in `setValue` and again in `checkBeforeSend`); Off and Frost protection
  still go (protective: never refused by a read; a write to a zone without
  an X-4FP does nothing), unconfirmed since the read back is a number. A
  read back or round showing a mode text clears it at once (question 2).
- **Envelope**: `product` and `status` were in all three answers: kept as
  they are.

## Decisions after the second real answers (2026-11-03, 0.1.3)

- **Clamps 1-16 only** (`LIMITS_RT2.tore` 16, the GCE PDF's "16 tores"):
  `Index_TORE17` and beyond are an X400 CT extension once wired on cce66's
  RT2 (frozen values), never clamps of the RT2: not read, not counted, never
  offered (no advanced option either: nothing to gain, a frozen index at
  best).
- **Clamp unit still not confirmed** (`UNIT_CONFIRMED.tore` false): no
  source gives it. GCE PDF: `Index=T` "index des 16 tores", no unit;
  `indexcourant5XX` in `status.json` (behind the password), no unit.
  pyecodevices_rt2 and the HA integration: a sensor with the unit the user
  types. The page of the RT2 shows only the instant power of a clamp. So
  they stay neither offered nor published (question 1). No instant power
  **per clamp** in `xdevices.json`: `Get=P` / `Get=S` give the instant
  values of the posts and sub-posts (built from clamps by the user), and
  `status.json` the same (`instant`, `sspencoursXX`, behind the password).
- **Firmware 3.00.04**: the RT2 whose reads were tested (docs, README).
- **M1 of the review cce66 r1**: `unknownZones` (`src/app.js`), the zones
  whose last `Get=FP` answer held no mode text (a number, nothing, a text
  not known), set from the answer itself (`noteZones`: the round's `Get=FP`
  as soon as it is answered, a read back of a command), cleared by a mode
  text, kept in `/data` (`unknownZones`, for this controller only: another
  address starts empty). Eco and Comfort refused there in `setValue` and in
  `checkBeforeSend`. Remaining window, in the docs: before the very first
  answer for a zone (just listed). The stricter "refuse until a mode text
  is seen" was not taken (it changes 0.1.1 for every user: Louis's call).
  The mutant removing the check of `setValue` survives: `checkBeforeSend`
  refuses the same command (defence in depth). A zone answering no mode
  keeps its old text in the model, but no decision reads it (`applyRead`
  takes only the targets read at `at`).
- **M3**: a guard of such a zone is listed "sent, cannot be confirmed"
  (`guardsUnconfirmable`), never "sent again" nor "check on site"; it is
  still sent again at the next 3 restarts (kept: protective; see Louis's
  decision of 2026-11-03 below for a zone that answers a mode later).
- **M2, M4, M5, M6**: tests (jump after the sentinel held; Frost protection
  on a numeric zone), docs intro, `timeout-minutes: 15` in CI.

## Next patch (review cce66 r1, 8c6259d) — done in 0.1.3

- M1: Eco / Comfort can still reach a zone that just answered a number: `numeric` only comes from a finished round (`src/app.js:1086`, `:1196`); `storeReadBack` (`:2143-2145`) ignores a numeric read-back and keeps the old text; a round in progress has already seen 0; at start or after a saved config, until the first full round (`:557`, up to one interval, 15-300 s). Keep a set of "numeric" zones updated on every `Get=FP` answer, read-backs included; keep it in `/data` at start or say the window in the docs; tests for the three cases, one killing the mutant of `checkBeforeSend` (`:2262`). Until then the docs' "Eco and Comfort refused there" is too broad.
- M2: `test/cce66.test.js:156-178`: after the sentinel, come back with a +67 MWh jump and assert it is held (the mutant "sentinel clears the reference" survives).
- M3: Off / Frost protection on a numeric zone: the status says "not applied yet, sent again" with no resend; the Off is resent at each of the next 3 restarts then "check on site". Give this case its own status and a sentence in the docs.
- M4: Frost protection on a numeric zone is not tested (a mutant refusing it survives): add it to the Off test.
- M5: the intro of `docs/fr.md` and `docs/en.md` (lines 3-7) still announces the clamps.
- M6: no `timeout-minutes` in `.github/workflows/ci.yml`.

## Decisions of Louis (2026-11-03)

- **No strict variant**: Eco and Comfort are NOT refused before the first
  read of a zone's mode (it would change the behaviour of 0.1.1 for every
  user). The window stays, documented in the docs: a zone just listed, the
  first read after updating from 0.1.2 or older, the first read after a
  change of address.
- **An Off kept for a zone answering a number stays kept, with no time
  limit**: not lifted when the zone reads its first mode. Once an X-4FP is
  wired there and another mode is read, it is sent again (protective
  direction); choosing a mode in Gladys lifts it. Said in the docs.

## Next patch (review cce66-n9 r1, 89a5373) — done (Unreleased)

- [x] m1: the texts (status, refusal, docs) now say "no known mode (a number, nothing or an
      unknown text)"; CHANGELOG line; tests for a missing key, `null` and an unknown text
      ("Confort-1") kill the mutant "number only".
- [x] m2: docs fr/en name the window after updating from 0.1.2 and after a change of address
      (no code change: Louis's decision, no strict variant).
- [x] m3: docs fr/en say an Off kept for such a zone is sent again once the zone answers another
      mode (kept with no limit: Louis's decision); the ack of that Off / Frost protection says
      "sent, cannot be confirmed" instead of "read again in a few seconds"; a test of the 3 resends
      at the next restarts, then none (kills the mutants `resends <= max` and "no resend for a
      numeric zone").
- [x] m4: the test "M1: a read back answering a number" checks `/data` right after the read back,
      before any round (kills the mutant without that save).
- [x] m5: docs, the `src/constants.js` comment: TORE17+ are a leftover on the tester's RT2 only;
      with an X400 CT wired today they would be real clamps.
- [ ] m5 (kept open): revisit the 16-clamp limit once the clamp unit is confirmed (an X400 CT
      wired = clamps 17+ alive). No index is touched until then: clamps are neither offered nor
      published.

## Next patch (review rt2-014-r1, minors)

- [ ] Docs, CHANGELOG and TODO: a kept Off/Frost is resent on another mode read only while some of its 3 resends are left (restart resends count). After that the status says "check on site". Lifting it by choosing Eco/Comfort needs the heating-modes option.
- [ ] Test pinning Louis's guard decision: Off clicked on a zone answering 0, the zone then answers "Confort", the next read sends `SetFP01=3`. Optionally a test pinning the documented window (a "strict variant" mutant survives).
- [ ] Old wording: `TODO.md` "a frozen index at best", the comment at `src/app.js:2252` "(a number)", and `guardsUnconfirmable` in `src/i18n.js` "no mode" → "no known mode".
