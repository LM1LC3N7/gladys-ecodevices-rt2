# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/releases/tag/v0.1.1
