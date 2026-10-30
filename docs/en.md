# Eco-Devices RT2 for Gladys

Brings **up to three GCE Electronics Eco-Devices RT2** into Gladys through
their local JSON API: the indexes of the teleinformation, of the current
clamps and of the pulse counters (water, gas, electricity), their relays,
their inputs, the pilot-wire zones of their X-4FP extensions and their X-THL
sensors (temperature, humidity, luminosity).

> Never tested with a real device: written from the API documentation of GCE
> Electronics ("API Eco Devices RT", 2017), the open library of the Home
> Assistant integration (pyecodevices_rt2) and cce66's test tools. Tell us
> what you see on yours. Not affiliated with GCE Electronics.

## Installation

1. In the Eco-Devices RT2, note the **API key** ("apikey" by default: change
   it). If you turned this protection off, leave the field empty.
2. In Gladys, Integrations > Eco-Devices RT2: type the address of the
   Eco-Devices (e.g. `192.168.1.60`; give it a **fixed address** in your
   router: its devices are tied to this address) and the key. On the same
   page:
   - list in "Relays Gladys may drive" the relays Gladys must drive, and
     those only (e.g. `R1`; see "Relays" below: never a pump, a ventilation,
     a door strike…);
   - list in "Extensions" the X-4FP and X-THL wired (e.g. `FP1-FP4, THL1`);
   - list in "Pulse counters" those to bring in, with what they measure and
     the unit of their index in the Eco-Devices (e.g.
     `C1:water:l, C2:gas:m3`).

   Then save.

3. "Test the connection" reads the Eco-Devices at once (once an interval has
   passed since the last read) and shows what it found.
4. In Discover, create the devices you want. A listed relay comes as a
   switch (or a light); the others come **read only** ("State (read only)"):
   Gladys shows their state, nothing can switch them.

A relay listed **after** its creation stays read only until you click
**"Update"** on it in Discover: it then gets its switch (or light), next to
its "State (read only)", which stays. The status of the integration says how
many relays are read only while none is listed, and which listed relays
still wait for "Update".

The Eco-Devices wants the key in the address of every request, over plain
http: anyone who can watch your local network can read it. The key is kept
by Gladys in its database, never shown again, sent only to the Eco-Devices,
and never written in the logs nor in the files of the integration.

The address must be an Eco-Devices RT2's: another GCE product (an IPX800,
say) is recognised by its answer and the status says so; nothing is sent to
it, not even an Off (after a restart neither), and nothing is published,
until an Eco-Devices RT2 answers there.

## What you get

| On the Eco-Devices RT2                | In Gladys                                                        | Code (in the name) |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------ |
| Teleinformation index 1 to 7          | energy index (kWh)                                               | `TI1`              |
| Current clamp 1 to 16                 | energy index (kWh)                                               | `TORE3`            |
| Pulse counter 1 to 12 (when listed)   | water or gas index (m³), or energy index (kWh)                   | `C1`               |
| Relay 1 to 10 (2 + an X-8R)           | read only, or a switch / light when you list it                  | `R3`               |
| Input 1 to 12                         | a binary input (read only)                                       | `D3`               |
| Zone of an X-4FP (FP1 to FP8, listed) | pilot wire (Off, Frost protection, Eco, Comfort, Comfort -1, -2) | `FP5`              |
| X-THL 1 and 2 (when listed)           | temperature (°C), humidity (%), luminosity (lux)                 | `THL1`             |

The API answers for the 10 relays and the 12 inputs, wired or not: all of
them are offered in Discover. Pilot-wire zone n is zone z of the X-4FP e:
n = 4 × (e − 1) + z (two X-4FP at most). A teleinformation or clamp index
shows in Discover only when it is above 0.

The Eco-Devices is read every 15 seconds by default (5 s at least): the
relays, then the inputs, the zones (when listed), the X-THL (when listed) and
the indexes, one request after the other. A value the Eco-Devices does not
give (absent, a text, out of range) is not published: never as 0. When the
relays cannot be read, the whole read fails; when another group fails, its
values are not published this time and the status says so.

## Indexes: never 0, never lower without your two clicks

Gladys counts the consumption and the cost from the differences of an index.
A wrong index would count thousands of kWh at once: every index goes through
a guard.

- An index at 0, absent or unreadable is **never** published; Gladys keeps
  the last one.
- A **drop** (meter replaced, reset) or a **jump** the house cannot draw
  (more than 100 kW on average since the last value for electricity,
  10 m³/h for water, 16 m³/h for gas, plus a small margin) is **held back**:
  the last value accepted stays, the status shows it ("Index held back…"),
  and nothing is counted. Neither time nor repetition makes it accepted.
- To accept it, check the value on the meter, then click "Accept the held
  index" **twice**: the first click lists the indexes held, the second
  (3 s to 5 min later) sends them to Gladys at the next read, only when they
  did not change meanwhile (otherwise, start again). A jump accepted is
  counted once as consumption; a drop accepted is not counted (Gladys skips a
  negative difference) and the values rise from there.
- The guard keeps its values in `/data` with the Gladys device it belongs
  to: an index held stays held after a restart (not its acceptance), and a
  device deleted then created again starts from the first value read.
- Its dates follow the session clock (the time at the start plus the
  measured time since): a jump of the system clock never widens its margin.
- When `/data` cannot be written or read, no index is published.

**Units (to check on a real Eco-Devices)**: the teleinformation and clamp
indexes are read in Wh and published in kWh, as the Home Assistant
integration does; a pulse counter is read in the unit you give. A counter
whose type you change gets a new feature, which starts from the first value
read.

## Several Eco-Devices RT2

Keep the first one in the top fields, and put the other one in
**"Eco-Devices RT2 #2"** (address with `:port` when needed, key, relays Gladys
may drive, extensions, counters), a third one in "Eco-Devices RT2 #3". Each
one has its own devices in Discover ("Eco-Devices #2 · Relay 1 (R1)"), its
list of relays and its status on its own line. The poll interval, the
heating option and the language are shared. "Accept the held index" answers
for each one.

**Never change the slot of an Eco-Devices to try another one**: the devices
already created stay with their slot.

## Each Eco-Devices keeps its devices

The API of the Eco-Devices RT2 gives no MAC address (only its status files,
behind the user or admin password, do). So the integration keeps, in
`/data`, **the address and the port** of the Eco-Devices the devices of each
slot belong to.

When the address or the port of the slot changes:

- no command leaves, not even an Off;
- the Offs kept for the old address are dropped;
- no value is published onto these devices, no index;
- Discover is empty for this slot;
- the status says so.

Put back the old address. If the Eco-Devices **only got a new address**,
click "Attach the devices" **twice** (within a minute), choosing the slot:
its devices then drive the Eco-Devices read at the new address. A slot
without any device created simply takes the Eco-Devices it reads.

**Limit**: another Eco-Devices RT2 put at the same address and port cannot
be told from the first one. If you replace the box, check the relays listed
and the indexes (a drop or a jump will be held back).

When `/data` cannot be read, only Off and Frost protection leave, to the
address typed, and no index is published.

## Relays: read only unless you list them

A relay you do not list is **read only**. To drive one from Gladys, list it
in "Relays Gladys may drive", e.g. `R1, R2:light` (`:light` makes it a
light, a switch otherwise), preferably before creating it in Discover;
already created, click "Update" on it in Discover. A switch or a light obeys
every "turn everything off" of Google, Alexa, the MCP and the scenes: never
list a pump, a freezer, a ventilation, a heating, a door strike nor a valve.
A relay removed from the list is read only again at once: its commands are
refused, and a switch-off the integration still held for it is dropped (in
memory and in `/data`, at a restart too). Its switch stays on the device in
Gladys (without effect): Gladys does not delete a single feature; only
deleting the device, then creating it again, removes it, with its history.

## Pilot wire

- **Off** and **Frost protection** need no option and go before everything
  else: during a pause after failed reads, with a refused key, with the queue
  of commands full, and before the first read after a restart (the zones
  come from the configuration). Clicked, they cut any request in progress (a
  read, a read back, a command, a resend), except another Off or Frost
  protection clicked just before. The same goes for switching off a relay
  you listed.
- **Eco, Comfort, Comfort -1, Comfort -2** drive the heating: they are off by
  default. Tick "Allow Eco and Comfort from Gladys" to allow them; every
  Gladys user, every scene and the Gladys app can then choose them. They are
  refused while the state cannot be written to `/data`.
- Zone `00` of the Eco-Devices (every zone at once) is never used.

An Off or a Frost protection is refused only when: the address is missing or
not valid, or the key is not valid; the zone is not listed in "Extensions";
the value is not one of the six modes; the Eco-Devices is not the device's
(another address or another product), or nothing tells (see "Each
Eco-Devices keeps its devices"). Switching a relay off is refused when the
relay is not listed.

Clicked before the configuration is read from Gladys (the key is kept there
only, never in `/data`), an Off asks Gladys for it at once and waits 3 s;
when it has not come, it is kept in memory and sent as soon as it is read
(read again 5 s later, then every minute at most), before anything goes to
Gladys; when the output turns out unknown or not listed, the status says so.
An Off kept in `/data` leaves the same way at start, without waiting for
Gladys. When the Eco-Devices does not take it within 3.5 s (no connection),
it is kept and sent again as soon as the Eco-Devices is free, before the read
backs, by the next reads that show another mode, and after a restart. An Off
clicked while another one has had no answer for 1 s cuts it. A resend cut by
a click before it left goes again right behind that click.

An Off or Frost protection the reads do not show is sent again, 3 times at
most; then the status says so (check on site). It is held until a newer
command on that zone leaves (your click), another Off / Frost protection, or,
once applied, another mode read twice in a row (changed on the Eco-Devices
itself, by its page or its schedules): never by the time. What was asked
before an Off on the same zone and not sent yet is cancelled, a Frost
protection waiting for a new try included: nothing leaves after it. A mode
sent by the integration before the Off and left without an answer (cut by
the Off, say), if the Eco-Devices still applies it within 5 s after it left,
is no change on the Eco-Devices: the Off is sent again.

## Commands

A command is written within 3.5 s of the click or refused with "nothing was
sent". It is then read back on the Eco-Devices (the relays or the zones): the
value asked is a success; another value is "not applied yet"; no answer in
time gives "sent, without confirmation". Two reads follow, 5 s and 20 s
later. The commands of a scene are written one after the other, then read
back once.

## Pauses and refusals

A failed read pauses 10 s, 30 s, 1 min, 2 min then 5 min (a minute at least
when the Eco-Devices answers 429 or 503), the pause kept at a restart; Eco,
Comfort and switching a relay on are refused until the pause ends. A key
refused by the Eco-Devices (401, 403) stops the reads until you change the
key or "Test the connection" succeeds. While an Eco-Devices does not answer
(or refuses the key, or is not an Eco-Devices RT2), its devices leave
Discover; a Scan does not put them back. They come back at the first read
that succeeds.

## Limits

- Indexes (teleinformation, clamps, counters), relays, inputs, X-4FP and
  X-THL only: the instant power, the posts and sub-posts, the prices, the
  virtual outputs and EnOcean are not in this version.
- Three Eco-Devices at most per integration.
- Known by its address and port (see above).
- http only (the Eco-Devices answers over http on the local network).
