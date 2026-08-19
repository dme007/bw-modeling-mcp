// Diagnose TRFN-423: warum scheitert der CREA-Lock in bwCreateTransformation?
// STUFE 1 — reine Reproduktion des heutigen Verhaltens. Erwartung: HTTP 423, kein Enqueue.
// Kein POST auf die TRFN-Ressource, es wird also nichts angelegt.
const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv, MEDIA_TYPES } = await import(`${D}/bw-client.js`);

const SRC = { type: 'ADSO', name: 'YT_FIS010' };
const TGT = { type: 'ADSO', name: 'YP_FIS010' };

const client = createClientFromEnv();
await client.loadMediaTypes();
const accept = MEDIA_TYPES['trfn'];
console.log('0) MEDIA_TYPES.trfn:', accept);

// Schritt 1: 8TRANSIENT → generierter TRFN-Name
const transientPath =
  `/sap/bw/modeling/trfn/8transient?GetIdOnly=true` +
  `&sourceobjecttype=${SRC.type}&targetobjecttype=${TGT.type}` +
  `&sourceobjectname=${SRC.name}&targetobjectname=${TGT.name}`;

let trfnName;
try {
  const { body } = await client.get(transientPath, accept);
  trfnName = body.match(/\bname="([^"]+)"/)?.[1]?.toUpperCase();
  console.log('1) 8TRANSIENT -> OK, Name:', trfnName);
} catch (e) {
  console.log('1) 8TRANSIENT -> FEHLER:', e.message.split('\n').slice(0, 3).join(' | '));
  process.exit(1);
}
const trfnLower = trfnName.toLowerCase();

console.log('2) Session-Cookies vor dem Lock:', JSON.stringify(client.sessionInfo()));

// Schritt 2: Lock exakt wie heute in transformation.ts:101 — rawPost, ohne X-sap-adt-sessiontype
const csrfToken = await client.getCsrfToken();
console.log('3) CSRF-Token vorhanden:', csrfToken ? `ja (${csrfToken.length} Zeichen)` : 'NEIN');

try {
  const r = await client.rawPost(`/sap/bw/modeling/trfn/${trfnLower}?action=lock`, '', {
    'activity_context': 'CREA',
    'Accept': accept,
    'x-csrf-token': csrfToken,
  });
  const handle = r.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  console.log('4) Lock via rawPost (heutiger Weg) -> UNERWARTET OK. Handle:', handle);
  console.log('   !!! Es steht jetzt ein Enqueue auf trfn/' + trfnLower);
} catch (e) {
  console.log('4) Lock via rawPost (heutiger Weg) -> FEHLER (erwartet):');
  console.log(e.message.split('\n').slice(0, 12).join('\n'));
}

console.log('5) Session-Cookies nach dem Lock:', JSON.stringify(client.sessionInfo()));
