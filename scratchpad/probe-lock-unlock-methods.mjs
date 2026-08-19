// Entscheidungstest: client.lock() -> client.unlock() OHNE PUT, ueber die BwClient-Methoden
// (also genau der Weg, den bw_update_transformation/bw_unlock nehmen).
//   Sperre faellt  -> die BwClient-Methoden sind ok, der PUT dazwischen ist die Ursache.
//   Sperre bleibt  -> die Lock-Methode ist die Ursache (Probe mit rawPost funktionierte).
// Kein Schreibzugriff: nur lock + unlock.
// Aufruf: node scratchpad/probe-lock-unlock-methods.mjs <tranid>
import { createClientFromEnv } from '../dist/bw-client.js';

const TRANID = process.argv[2];
if (!TRANID) { console.error('usage: node probe-lock-unlock-methods.mjs <tranid>'); process.exit(1); }

const client = createClientFromEnv();

const handle = await client.lock('trfn', TRANID);
console.log(`client.lock() -> ${handle ? 'HANDLE ' + handle : 'KEIN HANDLE'}`);

await client.unlock('trfn', TRANID);
console.log('client.unlock() -> ohne Fehler durchgelaufen');
