// These: Lock + Unlock in der stateful_enqueue-Session geben den Enqueue sauber frei.
// Selbst-verifizierend: 1) Client A: lock (stateful_enqueue) -> unlock (stateful_enqueue)
//                       2) Client B (neue Session): lock -> muss GELINGEN, wenn 1) freigab
//                       3) Client B: unlock -> Freigabe des Testlocks
// Testobjekt: TRFN1a (026MJUE4...) — B12-eigene, aktive TRFN, keine inhaltliche Aenderung.
import { createClientFromEnv, ECLIPSE_USER_AGENT, adtRequestId } from '../dist/bw-client.js';

const TRANID = (process.argv[2] ?? '026MJUE4EI8M41PT201JGZYHXRWUXB5B').toLowerCase();
const TRFN_TYPE = 'application/vnd.sap.bw.modeling.trfn-v1_0_0+xml';

function hdrs(csrf, extra = {}) {
  return {
    'sap-adt-request-id': adtRequestId(),
    'Content-Type': TRFN_TYPE,
    'Accept': TRFN_TYPE,
    'User-Agent': ECLIPSE_USER_AGENT,
    'X-sap-adt-profiling': 'server-time',
    'x-csrf-token': csrf,
    'X-sap-adt-sessiontype': 'stateful_enqueue',
    ...extra,
  };
}

async function lock(client, label) {
  const csrf = await client.getCsrfToken();
  const res = await client.rawPost(`/sap/bw/modeling/trfn/${TRANID}?action=lock`, '', hdrs(csrf));
  const handle = res.body?.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  console.log(`${label} lock: ${handle ? 'HANDLE ' + handle.slice(0, 12) + '…' : 'FEHLGESCHLAGEN — ' + (res.body ?? '').slice(0, 200)}`);
  return handle;
}

async function unlock(client, label) {
  const csrf = await client.getCsrfToken();
  const res = await client.rawPost(`/sap/bw/modeling/trfn/${TRANID}?action=unlock`, '', hdrs(csrf));
  console.log(`${label} unlock: body=${(res.body ?? '').slice(0, 120) || '(leer, ok)'}`);
}

const A = createClientFromEnv();
const h1 = await lock(A, 'A');
if (!h1) process.exit(1);
await unlock(A, 'A');

const B = createClientFromEnv();
const h2 = await lock(B, 'B');
if (h2) {
  console.log('=> ERSTER LOCK WURDE FREIGEGEBEN — stateful_enqueue-These BESTAETIGT.');
  await unlock(B, 'B');
  // Gegenprobe: dritter Lock aus Session C — prueft, ob auch B sauber freigab.
  const C = createClientFromEnv();
  const h3 = await lock(C, 'C');
  if (h3) {
    console.log('=> AUCH B WURDE FREIGEGEBEN — Mechanismus reproduzierbar.');
    await unlock(C, 'C');
    console.log('   (C ebenfalls entsperrt — SM12 sollte leer sein fuer', TRANID.toUpperCase() + ')');
  } else {
    console.log('=> B blieb gesperrt — Freigabe nicht reproduzierbar, SM12 noetig.');
  }
} else {
  console.log('=> Erster Lock blieb stehen — These widerlegt, SM12 noetig fuer', TRANID.toUpperCase());
}
