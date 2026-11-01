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
- [ ] **First real run** (cce66): the integration itself on his RT2; until
      then the docs and the manifest say "never tested with a real device".
- [ ] **Milestone 2**: instant power of the posts (`Get=P`), posts and
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
- [x] Firmware: not given for the RT2 (his ED3 is 1.3.0, his IPX800 V5
      5.7.2).

Still open, to ask on the forum (short, in French):

1. Pinces : sur la page de l'Eco-Devices, que vaut la pince 1 (en kWh ou en
   Wh) au moment où l'API donne `Index_TORE1` ? Et que sont les pinces 17 à
   20 (d'autres pinces, ou la production des pinces 1 à 4) ?
2. Fil pilote : as-tu un X-4FP branché ? Si oui, que montre sa page pour la
   zone 1 quand l'API répond 0 ? Change un mode depuis la page, puis
   renvoie `Get=FP` : le nombre change-t-il ?
3. `Get=D` : la réponse complète (clés `D1` à `D12`, des nombres 0/1 ?).
4. `Get=XTHL` si tu as un X-THL : la réponse complète.
5. Une mauvaise clé d'API : que répond `Get=R` (401, ou une page, ou
   `"status": "Error"`) ?
6. La version du firmware du RT2 (page d'accueil ou `status.xml`).
7. Avec l'intégration lancée : tout va bien à 15 s (cinq requêtes par
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
