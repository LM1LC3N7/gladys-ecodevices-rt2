# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: up to three GCE Eco-Devices RT2 through their local JSON API.
- Indexes of the teleinformation (TI1 to TI7) and of the current clamps (TORE1
  to TORE16) in kWh, pulse counters (C1 to C12) as water, gas or electricity:
  never 0, never lower, a jump or a drop held back until "Accept the held
  index" is clicked twice.
- Relays R1 to R10 read only unless listed; digital inputs D1 to D12;
  pilot-wire zones FP1 to FP8 of the X-4FP (Off and Frost protection always
  sent, Eco and Comfort behind an option); X-THL 1 and 2.
- "Test the connection", "Attach the devices" (a box moved to another
  address), another GCE product at the address recognised.
- French and English guides.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ecodevices-rt2/commits/main
