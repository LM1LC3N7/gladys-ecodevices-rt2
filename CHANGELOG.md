# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.3.0] - 2026-11-20

### Added

- Power counters of the current clamps (`Index_TORE1` to `Index_TORE20`:
  the 20 "compteurs de puissance" of firmware 3, each bound in the RT2 to a
  clamp input with a mode), listed in the new field "Power counters" with
  their mode (`T1, T2:production, T3:injection, T4:drawn`; no mode:
  consumption): energy, production, injection (`grid-sensor/output-index`)
  or drawn (`grid-sensor/input-index`) index in kWh, read in Wh (GCE wiki,
  page Tore: "index en Wh"; the values of three real RT2 are thousands of
  kWh), through the index guard (never 0, never lower, a drop held). The
  API gives neither the mode nor the counting unit (kWh or kVAh): the docs
  say to keep kWh and to compare the first value with the page of the RT2.
  A counter counting but not listed is named in the status; a listed one
  without a value is named too (bound to no clamp, or erased?) and not
  counted among the indexes read; an RT2 on firmware 2
  (`Index_TORE_Cons1`) has its power counters not read at all, said.
- Pulse counters: the French words (`C1:eau:l`, `C2:gaz:m3`,
  `C3:électricité:wh`) are understood; a counter not understood is said with
  the form expected. A counter (pulse or power) given twice with different
  settings is refused in whole ("C1 ×2"), never the first one taken.

### Changed

- The clamps 17 to 20 are power counters of the RT2 like the others (no
  longer taken for an X-400 CT left over), listable.
- Tests on cce66's `Index=all` (2026-10-31) for the power counters, his
  `status.json` (2026-11-14, after a factory reset: every power counter at
  "--") and his "C1:Eau, C2".
- Guard mutants: `scripts/mutants.mjs` and `scripts/mutants.json` (run by
  hand, not by the CI).

## [0.2.0] - 2026-11-19

### Added

- Teleinformation details (`TIC` in "Extensions", read by `Get=TI`):
  apparent power (VA, `PAPP`), current (A, `IINST`) and the tariff period
  as a text (`PTEC`: "Toutes les heures", "Heures creuses"…, Tempo and EJP
  included). A value that is not a number, or a period not known, is not
  published (never 0). From the answer of a real RT2 (cce66, Sagem SC10 in
  historic teleinformation). Its `BASE` is the index `TI1` already gives: not
  read twice.
- Instant power of the posts (`P1-P8` in "Extensions", read by `Get=P`), in
  W, 0 included. Only the posts listed: a post without a clamp also reads 0.
- The status says when the teleinformation is three-phase (current not
  read) or in standard mode (nothing read).
- A slow Eco-Devices: the optional groups (zones, X-THL, teleinformation,
  posts) are read after the relays, inputs and indexes; a group the 20 s of
  a round leaves unsent is said unread and the rest is still published.
- Tests on the full `status.json` of a real RT2 (firmware 3.00.04), kept as
  a fixture.

## [0.1.4] - 2026-11-03

### Fixed

- Pilot wire: the status and the refusal say "no known mode (a number,
  nothing or an unknown text)": since 0.1.3, a zone answering a text not
  known, `null` or no key at all also refuses Eco and Comfort (the notes of
  0.1.3 said only "a number or nothing").
- Pilot wire: the ack of an Off or a Frost protection sent to such a zone
  says "sent, cannot be confirmed", no longer "read again in a few seconds".

### Changed

- Docs: the window before the first answer of a zone also covers the first
  read after updating from 0.1.2 and after a change of address; an Off kept
  for a zone without a mode is sent again once that zone answers another
  mode (choose the mode in Gladys to lift it); clamps 17 and beyond are a
  leftover on the tester's RT2 only.

## [0.1.3] - 2026-11-03

### Fixed

- Pilot wire: a zone answering a number (or nothing) instead of a mode refuses
  Eco and Comfort from that answer on, a read back after a command or a read
  still in progress included, and after a restart (kept in `/data`), until a
  mode is read.
- Pilot wire: an Off or a Frost protection sent to such a zone is said "sent,
  cannot be confirmed" in the status, no longer "sent again".
- Clamps: only clamps 1 to 16 are read; `Index_TORE17` and beyond (what is
  left of an X400 CT extension on a real RT2) are no longer counted.

### Changed

- Docs: firmware 3.00.04 of a real RT2 noted; the intro no longer announces
  the clamps; the unit of a clamp index explained.
- CI: the test job is bounded (`timeout-minutes`).

## [0.1.2] - 2026-11-01

### Changed

- From the answers of a real Eco-Devices RT2 (cce66): teleinformation indexes
  offered and published in kWh (read in Wh, confirmed against an Eco-Devices
  3 on the same meter); clamps still wait for their unit, now up to TORE20.

### Fixed

- An index read 4294967295 (an entry with nothing behind it) is never
  offered, published nor held as a jump.
- A pilot-wire zone answering a number instead of a mode is not published,
  is listed in the status, and refuses Eco and Comfort (Off and Frost
  protection still sent).

## [0.1.1] - 2026-10-30

### Added

- First version: up to three GCE Eco-Devices RT2 through their local JSON API.
- Pulse counters (C1 to C12) as water, gas or electricity: never 0, never
  lower, a jump or a drop held back until "Accept the held index" is clicked
  twice. Teleinformation and clamp indexes wait for their unit to be
  confirmed.
- Relays R1 to R10 read only unless listed; digital inputs D1 to D12;
  pilot-wire zones FP1 to FP8 of the X-4FP (Off and Frost protection always
  sent, Eco and Comfort behind an option); X-THL 1 and 2.
- "Test the connection", "Attach the devices" (a box moved to another
  address), another GCE product at the address recognised.
- French and English guides.
- Review r1: every command waits for a read showing an Eco-Devices RT2 (an
  IPX800 V4 at the address takes the same commands), and any answer of
  another product stops everything, kept across restarts; teleinformation
  and clamp indexes held back until their unit is confirmed; a counter whose
  unit changes stops its index; /data never writable lets the Offs go;
  /data waits bounded; one address in one slot only; clearer acks.
- Review r2: with /data lost (a Gladys restored elsewhere), Off and Frost
  protection go to the address typed, the rest waits for "Attach the
  devices"; a write answer without "product" is taken after the product
  read; a read without it is named in the status.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/releases/tag/v0.1.1
