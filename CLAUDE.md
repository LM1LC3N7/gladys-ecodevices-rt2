# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the GCE Eco-Devices RT2: a
Node.js service (Node 22+, ESM, no build step) in its own sandboxed Docker
container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the Eco-Devices through its local JSON API
(`/api/xdevices.json`).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store .   # store admission checks
node scripts/cover.mjs cover.png          # the store cover (dev only)
```

## Architecture

```
index.js              SDK wiring only: handlers registered before connect()
src/handlers.js       the SDK handlers, shared with the tests
src/hub.js            Rt2Hub: up to 3 Rt2App (slots), one view of Gladys each
src/app.js            Rt2App: one Eco-Devices: lifecycle, rounds, identity (owner),
                      guards of the protective commands, index guards, commands, status
src/guard.js          the index guard (never 0, never lower, jumps held)
src/rt2/http.js       one HTTP request: bounded, deadline, cut, settles once closed
src/rt2/client.js     the lane (one request at a time, priorities) and the API queries
src/rt2/model.js      what the answers mean (pure): envelope, values, indexes, writes
src/devices.js        targets -> Gladys devices and states (pure)
src/publisher.js      states within the Gladys rate limit
src/store.js          /data: pace, pause, refused key tag, owner, guards, index states
src/config.js         DEFAULTS (mirror the manifest) + normalization, codes
src/constants.js      API, modes, keys, limits, timings
src/i18n.js           French and English texts
test/helpers/         fake Eco-Devices on the virtual clock and over real HTTP, app setup
test/kit/             parts of the shared test kit (clocks, HTTP server)
```

Safety rules (see TODO.md "Decisions"): relays read only unless listed;
pilot wire Off and Frost protection (and switching a listed relay off) are
protective: never refused by an option, a pause, a queue or a read, they cut
the request in flight and are kept in /data and sent again; Eco and Comfort
behind `allow_heating_modes` (off); never `SetFP00` (every zone); one request
to the Eco-Devices at a time; an index is never 0 nor lower, a jump or a drop
waits for two clicks; the API key (in the query string of every request) is
never logged, nor put in an error, a status or /data; success only after a
read back.

## Rules

- **External ids are forever** (`ext:<selector>:<kind>:<code>`, the slot n >= 2
  as `ext:<selector>:rt2<n>:<kind>:<code>`), and so are the feature keys and
  the manifest keys (`<key>_<n>` for the slots).
- **A device never drives another Eco-Devices**: the owner of each slot is in
  /data (its address and port: the API gives no MAC); any command, value,
  guard or Discover entry goes only when the Eco-Devices read is the owner
  (see "Identity" in src/app.js and TODO.md).
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow**; `test/manifest.test.js` checks
  they agree.
- **Changelog** under `## [Unreleased]`.
- **Manifest texts** are `{ "en", "fr" }`; user-facing text is bilingual.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network beyond 127.0.0.1.
