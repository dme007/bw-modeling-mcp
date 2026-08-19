// Aktiver Unlock-Versuch für hängende TRFN-Sperren, Wire-Format wie der Eclipse-Trace:
//   POST /sap/bw/modeling/trfn/{tranid}?action=unlock
//   Header: sap-adt-request-id, Content-Type/Accept trfn-v1_0_0+xml, User-Agent, X-sap-adt-profiling
// Varianten:
//   eclipse  — exakt wie im Trace (KEIN X-sap-adt-sessiontype)
//   enqueue  — zusätzlich X-sap-adt-sessiontype: stateful_enqueue
// Aufruf: node scratchpad/probe-unlock.mjs <variant> <tranid> [<tranid2> ...]
import { createClientFromEnv, ECLIPSE_USER_AGENT, adtRequestId } from '../dist/bw-client.js';

const [variant, ...tranids] = process.argv.slice(2);
if (!variant || tranids.length === 0) {
  console.error('usage: node probe-unlock.mjs <eclipse|enqueue> <tranid> [...]');
  process.exit(1);
}

const TRFN_TYPE = 'application/vnd.sap.bw.modeling.trfn-v1_0_0+xml';

for (const tranid of tranids) {
  const client = createClientFromEnv(); // eigene Session pro Objekt
  const csrf = await client.getCsrfToken();
  const headers = {
    'sap-adt-request-id': adtRequestId(),
    'Content-Type': TRFN_TYPE,
    'Accept': TRFN_TYPE,
    'User-Agent': ECLIPSE_USER_AGENT,
    'X-sap-adt-profiling': 'server-time',
    'x-csrf-token': csrf,
  };
  if (variant === 'enqueue') headers['X-sap-adt-sessiontype'] = 'stateful_enqueue';
  const res = await client.rawPost(
    `/sap/bw/modeling/trfn/${tranid.toLowerCase()}?action=unlock`,
    '',
    headers,
  );
  console.log(`${tranid}: HTTP ${res.status}${res.body ? ' — ' + res.body.slice(0, 200) : ''}`);
}
