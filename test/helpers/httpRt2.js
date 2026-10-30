// -----------------------------------------------------------------------------
// A fake Eco-Devices RT2 on a REAL local HTTP server (127.0.0.1, the kit's
// httpServer), for the scenarios on a real clock: two of them stand for two
// boxes of one house. It answers `/api/xdevices.json` (`Get=R|D|FP|XTHL`,
// `Index=all`, `SetR`, `ClearR`, `SetFPxx`) as the in-memory fake does.
// Every write is recorded.
// -----------------------------------------------------------------------------

import { httpServer, reply } from '../kit/index.mjs';
import { FP_TEXT, answerOf, fakeRt2 } from './fakeRt2.js';

/** `{ srv, state, writes(), address }`: close with `srv.close()`. */
export async function httpRt2({ key = 'k', latencyMs = 3 } = {}) {
  const state = fakeRt2({ key });
  const writes = [];
  const route = (r) => {
    if (state.key !== '' && r.query.key !== state.key) return reply(401, { status: 'Error' });
    const group = r.query.Get ?? (r.query.Index === 'all' ? 'all' : undefined);
    if (group) return answerOf(state, group);
    const ok = { product: state.product, status: 'Success' };
    for (const [name, value] of Object.entries(r.query)) {
      if (name === 'SetR' || name === 'ClearR') {
        writes.push(`${name}=${value}`);
        state.R[Number(value)] = name === 'SetR' ? 1 : 0;
        return ok;
      }
      const m = /^SetFP(\d{2})$/.exec(name);
      if (m) {
        writes.push(`${name}=${value}`);
        state.FP[Number(m[1])] = FP_TEXT[Number(value)];
        return ok;
      }
    }
    return { product: state.product, status: 'Error' };
  };
  const srv = await httpServer({ latencyMs, routes: { '/api/xdevices.json': route } });
  return { srv, state, address: `127.0.0.1:${srv.port}`, writes: () => [...writes] };
}
