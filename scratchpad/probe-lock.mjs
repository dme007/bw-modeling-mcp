// Nimmt einen TRFN-Lock in der gewuenschten Session-Variante und beendet sich.
// Aufruf: node scratchpad/probe-lock.mjs <stateful|enqueue|none> [tranid]
import { createClientFromEnv, ECLIPSE_USER_AGENT, adtRequestId } from '../dist/bw-client.js';

const variant = process.argv[2] ?? 'stateful';
const TRANID = (process.argv[3] ?? '026MJUE4EI8M41PT201JGZYHXRWUXB5B').toLowerCase();
const TRFN_TYPE = 'application/vnd.sap.bw.modeling.trfn-v1_0_0+xml';

const client = createClientFromEnv();
const csrf = await client.getCsrfToken();
const headers = {
  'sap-adt-request-id': adtRequestId(),
  'Content-Type': TRFN_TYPE,
  'Accept': TRFN_TYPE,
  'User-Agent': ECLIPSE_USER_AGENT,
  'X-sap-adt-profiling': 'server-time',
  'x-csrf-token': csrf,
};
if (variant === 'stateful') headers['X-sap-adt-sessiontype'] = 'stateful';
if (variant === 'enqueue') headers['X-sap-adt-sessiontype'] = 'stateful_enqueue';

const res = await client.rawPost(`/sap/bw/modeling/trfn/${TRANID}?action=lock`, '', headers);
const handle = res.body?.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
console.log(`LOCK ${TRANID.toUpperCase()} (${variant}): ${handle ? 'HANDLE ' + handle : 'FEHLGESCHLAGEN'}`);
console.log('set-cookie:', JSON.stringify((res.headers['set-cookie'] ?? []).map(c => c.split(';')[0].slice(0, 60))));
