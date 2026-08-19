// Entscheidungstest fuer einen client-seitigen Unlock-Fix.
// Sequenz auf EINEM Client (eine Session):
//   1. lock
//   2. GET /m  (Original-XML + timestamp holen)
//   3. put     (INHALTSGLEICHES XML zurueck — keine fachliche Aenderung)
//   4. lock    (erneut: die nach dem PUT frische Instanz bekommt count = 1)
//   5. unlock  (count 1 -> 0  =>  DEQUEUE_ERSTRFN_TRANID muesste feuern)
// Danach per ENQUEUE_READ pruefen, ob die Sperre weg ist.
// Aufruf: node scratchpad/probe-relock-after-put.mjs <tranid>
import { createClientFromEnv, MEDIA_TYPES } from '../dist/bw-client.js';

const TRANID = process.argv[2];
if (!TRANID) { console.error('usage: node probe-relock-after-put.mjs <tranid>'); process.exit(1); }
const lower = TRANID.toLowerCase();

const client = createClientFromEnv();
const accept = MEDIA_TYPES['trfn'];

// 1. Lock
const handle1 = await client.lock('trfn', TRANID);
console.log(`1. lock       -> ${handle1 ? 'HANDLE ' + handle1.slice(0, 16) + '…' : 'FEHLGESCHLAGEN'}`);

// 2. Original lesen (gleiche Session)
const got = await client.get(`/sap/bw/modeling/trfn/${lower}/m`, accept);
const timestamp = got.headers['timestamp'] ?? got.headers['TIMESTAMP'] ?? '';
console.log(`2. get /m     -> ${got.body.length} Zeichen, timestamp=${timestamp}`);

// 3. PUT — exakt derselbe Inhalt zurueck
await client.put('trfn', TRANID, handle1, got.body, timestamp);
console.log('3. put        -> ok (inhaltsgleich)');

// 4. Erneut sperren: setzt auf der frischen Instanz count = 1
let handle2 = null;
try {
  handle2 = await client.lock('trfn', TRANID);
  console.log(`4. lock (2.)  -> ${handle2 ? 'HANDLE ' + handle2.slice(0, 16) + '…' : 'KEIN HANDLE'}`);
} catch (e) {
  console.log(`4. lock (2.)  -> FEHLER: ${String(e).split('\n')[0]}`);
}

// 5. Unlock
await client.unlock('trfn', TRANID);
console.log('5. unlock     -> ohne Fehler durchgelaufen');
