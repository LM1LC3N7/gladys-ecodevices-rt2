# gladys-ecodevices-rt2

[Gladys Assistant](https://gladysassistant.com) integration for the **GCE
Electronics Eco-Devices RT2** (up to three in one installation), through its
local JSON API: indexes of the teleinformation, of the current clamps and of
the pulse counters, relays (read only unless you list them), digital inputs,
pilot-wire zones of the X-4FP, X-THL sensors.

- Indexes: never 0; a drop or a jump is held back until you accept it in
  two clicks.
- Pilot wire: Off and Frost protection go first, without any option; Eco and
  Comfort are off by default.
- Relays: read only unless listed in "Relays Gladys may drive".
- The API key is never written in the logs nor in `/data`.
- Each Eco-Devices keeps its devices (known by its address and port, the API
  giving no MAC address): a box at another address never gets their
  commands.

Never tested with a real device. Not affiliated with GCE Electronics.

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

See `CLAUDE.md` (architecture, rules) and `TODO.md` (status, decisions).
Licensed under the Apache License 2.0; ported logic credited in
`THIRD_PARTY_NOTICES.md`.
