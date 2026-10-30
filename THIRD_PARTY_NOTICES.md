# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below. The ported parts were rewritten
in JavaScript; they are changed from the originals (another language, another
structure, only what this integration needs). None of the original code is
copied as is.

## pyecodevices_rt2

- Project: [pcourbin/pyecodevices_rt2](https://github.com/pcourbin/pyecodevices_rt2)
  version 1.3.4 (commit 3802bc5), "Get information from GCE Ecodevices RT2",
  by Pierre Courbin, MIT licence.
- What is ported (in `src/constants.js`, `src/rt2/model.js` and
  `src/rt2/client.js`): the path `/api/xdevices.json` and its `key`
  parameter, the `product` (`EcoDevices_RT`) and `status` (`Success`) of the
  answers, the reads `Get=R`, `Get=D`, `Get=FP`, `Get=XTHL` and `Index=all`
  and the keys of their answers (`R<n>`, `D<n>`, `FP<e> Zone <z>` and their
  texts, `THL<n>-TEMP|HUM|LUM`, `Index_TI<n>`, `Index_TORE<n>`,
  `Index_C<n>`), the writes `SetR` / `ClearR` and `SetFPxx` with the zone
  number `4 * (extension - 1) + zone` and the mode codes.
- Changes: rewritten in JavaScript for a Gladys external integration; one
  request at a time with priorities, bounded answers read as untrusted data,
  no toggle, no counter write, never the zone 00 (every zone at once).

### MIT licence of pyecodevices_rt2

```
MIT License

Copyright (c) 2021, Pierre COURBIN

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ecodevices_rt2 (Home Assistant integration)

- Project: [pcourbin/ecodevices_rt2](https://github.com/pcourbin/ecodevices_rt2)
  version 2.2.10 (commit 91c27bb), by Pierre Courbin, Apache License 2.0
  (no NOTICE file in the project).
- What was taken: the meaning and the default units of the values (indexes
  of the teleinformation, the clamps and the counters in Wh, the pilot-wire
  modes of an X-4FP as a heater), the ranges (relays 1 to 10, inputs 1 to
  12, X-4FP modules 1 and 2, X-THL 1 and 2); no code.

## The GCE Electronics documentation and cce66's tools (no code)

The commands were also checked against "API Eco Devices RT" (GCE Electronics,
01/02/2017) and the `GCE_EDRT2_Api-Deck v1.html` tester of
[cce66/Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub](https://github.com/cce66/Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub)
(commit e76f2b3, MIT): facts of the API only, nothing copied.

## gladys-ipx800, gladys-ecodevices (same author)

The structure of `src/app.js`, `src/hub.js`, `src/rt2/` and `src/store.js`
comes from gladys-ipx800, and the index guard (`src/guard.js`) from
gladys-ecodevices, both of the same author and licence (Apache-2.0).

## gladys-testkit (tests only)

`test/kit/` copies parts of the shared test kit of the same author
(Apache-2.0); it is not in the image.
