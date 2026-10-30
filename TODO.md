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
- [ ] **Review** (xhigh: pilot wire, relays, energy indexes).
- [ ] **First real device** (cce66): answers to the questions below; until
      then the docs and the manifest say "never tested with a real device".
- [ ] **Milestone 2**: instant power of the posts (`Get=P`), posts and
      sub-posts (`Index=P|S`), teleinformation details (`Get=TI`: current
      tariff, apparent power), virtual outputs (`Get=VO`), EnOcean (`Get=XENO`:
      actuators behind the same rules as the relays), prices.
- [ ] **Release**: `gi ci`, Release workflow, topic (only after the review).

## Questions pour cce66

Everything below rests on one source only (the reference library
pyecodevices_rt2, or the GCE PDF of 2017, or cce66's Api-Deck), so it is to
be checked on his boxes. Asked as raw answers (with the key removed).

1. `GET /api/xdevices.json?key=…&Get=R`: the full answer. Are the keys `R1`
   to `R10` numbers 0/1? Is `"product": "EcoDevices_RT"` there (the
   integration refuses another product: an IPX800 answers `IPX800_V4`), and
   `"status": "Success"`? (pyecodevices_rt2 only.)
2. Same for `Get=D` (`D1` to `D12`): which inputs exist on the RT2 itself,
   which come from an X-8D?
3. `Get=FP` with his X-4FP: the exact texts (`Confort`, `Eco`, `Hors Gel`,
   `Arret` or `Arrêt`, `Confort -1`, `Confort -2`) and the value of a zone
   without extension (pyecodevices_rt2 maps a `0` to "unknown"). `SetFP05=3`
   on the second X-4FP: does it stop its zone 1? (GCE PDF: 00 to 08, 00 for
   every zone; the integration never sends 00.)
4. `Get=XTHL` (if he has an X-THL): keys `THL1-TEMP|HUM|LUM` as numbers?
   (pyecodevices_rt2; the GCE PDF only says `Get=X` works with ENO and THL.)
5. `Index=all`: are the keys `Index_TI1`..`Index_TI7`, `Index_TORE1`..,
   `Index_C1`..? **In which unit** are the teleinformation and clamp
   indexes: Wh (the Home Assistant integration's default, used here and
   divided by 1000) or kWh? Compare with the index on the meter and on the
   Eco-Devices page. A counter: raw pulses, or its unit after the
   coefficient set in the Eco-Devices?
6. A wrong API key: 401, or a 200 with `"status": "Error"`, or an HTML page?
   The GCE PDF shows commands answered "without key" (`Get=D`, `Index=all`,
   `Get=FP`...): do they answer with a wrong key too? (Only `Get=R` is the
   round's first read here, and a 401 / 403 on it stops the reads.)
7. Does any answer of the JSON API (or `Get=all`) give the MAC address? The
   GCE PDF puts it in `status.json` only, behind the user password: the
   integration then knows a box by its address and port.
8. Five requests every 15 s (`Get=R`, `Get=D`, `Get=FP`, `Get=XTHL`,
   `Index=all`): does the Eco-Devices cope, along with its own pages?
9. The clamps 1 to 4: do they also have a production index (the Home
   Assistant docs mention it, its code does not read it)?
10. The firmware version of his RT2 (the API of 2017 is assumed).

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
  12 inputs, 16 clamps, 12 counters, 7 teleinformation indexes, 2 X-THL.
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
  (divided by 1000: the Home Assistant default, to confirm, question 5);
  listed when above 0 or created. Counters: only those in `counters`
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
