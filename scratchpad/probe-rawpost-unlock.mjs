// Testet das Muster von query_update.ts / rkf_create.ts / datasource.ts:
// Lock -> PUT -> Unlock per rawPost OHNE vorheriges Nachsperren.
// Ablauf:
//   1. lock, 2. GET /m, 3. put (inhaltsgleich), 4. rawPost-unlock (wie in jenen Dateien),
//   5. 25 s Pause  <-- hier misst der Aufrufer die Sperrtabelle
//   6. Aufraeumen: client.lock + client.unlock (der gefixte Weg) -> Sperre faellt
// Aufruf: node scratchpad/probe-rawpost-unlock.mjs <tranid>
import { createClientFromEnv, MEDIA_TYPES } from '../dist/bw-client.js';

const TRANID = process.argv[2];
if (!TRANID) { console.error('usage: node probe-rawpost-unlock.mjs <tranid>'); process.exit(1); }
const lower = TRANID.toLowerCase();
const accept = MEDIA_TYPES['trfn'];

const client = createClientFromEnv();

const handle = await client.lock('trfn', TRANID);
console.log(`1. lock            -> ${handle ? 'ok' : 'FEHLGESCHLAGEN'}`);

const got = await client.get(`/sap/bw/modeling/trfn/${lower}/m`, accept);
const timestamp = got.headers['timestamp'] ?? '';
await client.put('trfn', TRANID, handle, got.body, timestamp);
console.log('2. put             -> ok (inhaltsgleich)');

// 3. Unlock EXAKT wie in query_update/rkf_create/datasource: nackter rawPost, kein Re-Lock
const csrf = await client.getCsrfToken();
await client.rawPost(`/sap/bw/modeling/trfn/${lower}?action=unlock`, '', {
  'Content-Type': accept,
  'Accept': accept,
  'x-csrf-token': csrf,
  'X-sap-adt-sessiontype': 'stateful',
});
console.log('3. rawPost-unlock  -> ohne Fehler durchgelaufen');
console.log('4. MESSFENSTER: 25 s — jetzt ENQUEUE_READ pruefen …');

await new Promise((r) => setTimeout(r, 25000));

// 5. Aufraeumen ueber den gefixten Weg (client.unlock sperrt vorher nach)
await client.unlock('trfn', TRANID);
console.log('5. client.unlock   -> aufgeraeumt');
