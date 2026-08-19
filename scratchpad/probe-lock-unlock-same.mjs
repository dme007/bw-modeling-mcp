// Entscheidender Test: Lock UND Unlock auf DEMSELBEN Client, beide mit
// X-sap-adt-sessiontype: stateful. Frage: verwendet der Server denselben Rollbereich
// wieder (dann ist p_s_enqueue-count beim Unlock = 1 und DEQUEUE_ERSTRFN_TRANID feuert),
// oder bekommt jeder Request einen frischen (count wird -1, Sperre bleibt)?
// Aufruf: node scratchpad/probe-lock-unlock-same.mjs [tranid]
import { createClientFromEnv, ECLIPSE_USER_AGENT, adtRequestId } from '../dist/bw-client.js';

const TRANID = (process.argv[2] ?? '026MJUE4EI8M41PT201JGZYHXRWUXB5B').toLowerCase();
const TRFN_TYPE = 'application/vnd.sap.bw.modeling.trfn-v1_0_0+xml';

const client = createClientFromEnv();

function hdrs(csrf) {
  return {
    'sap-adt-request-id': adtRequestId(),
    'Content-Type': TRFN_TYPE,
    'Accept': TRFN_TYPE,
    'User-Agent': ECLIPSE_USER_AGENT,
    'X-sap-adt-profiling': 'server-time',
    'x-csrf-token': csrf,
    'X-sap-adt-sessiontype': 'stateful',
  };
}

const csrf1 = await client.getCsrfToken();
const lockRes = await client.rawPost(`/sap/bw/modeling/trfn/${TRANID}?action=lock`, '', hdrs(csrf1));
const handle = lockRes.body?.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
console.log(`LOCK: ${handle ? 'HANDLE ' + handle : 'FEHLGESCHLAGEN'}`);

// KEIN Zwischenrequest, gleicher Client, gleicher Cookie-Jar, gleicher Session-Typ.
const csrf2 = await client.getCsrfToken();
console.log('UNLOCK wird gesendet (sollte im Debugger anhalten) …');
const unlockRes = await client.rawPost(`/sap/bw/modeling/trfn/${TRANID}?action=unlock`, '', hdrs(csrf2));
console.log(`UNLOCK: body=${(unlockRes.body ?? '').slice(0, 150) || '(leer)'}`);
