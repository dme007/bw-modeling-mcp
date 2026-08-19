// STUFE 3 — RSDS-Quelle (DataSource -> aDSO), die Schicht-1-Transformation aus B12.
// Nur 8TRANSIENT + Lock. Kein POST, es wird nichts angelegt.
const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv, MEDIA_TYPES } = await import(`${D}/bw-client.js`);

const DS   = 'ZI_B12_ACDOCA';
const SSYS = 'ODPCDSD401';
const TGT  = 'YT_FIS010';

const client = createClientFromEnv();
await client.loadMediaTypes();
const accept = MEDIA_TYPES['trfn'];

// exakt die Kodierung aus transformation.ts:71
const srcNameForUrl = encodeURIComponent(DS.padEnd(30) + SSYS.padEnd(10)).replace(/%20/g, '+');

const transientPath =
  `/sap/bw/modeling/trfn/8transient?GetIdOnly=true` +
  `&sourceobjecttype=RSDS&targetobjecttype=ADSO` +
  `&sourceobjectname=${srcNameForUrl}&targetobjectname=${TGT}`;

let name;
try {
  const { body } = await client.get(transientPath, accept);
  name = body.match(/\bname="([^"]+)"/)?.[1]?.toUpperCase();
  console.log('1) 8TRANSIENT (RSDS) -> OK, Name:', name);
} catch (e) {
  console.log('1) 8TRANSIENT (RSDS) -> FEHLER:', e.message.split('\n').slice(0, 6).join(' | '));
  process.exit(1);
}

const csrf = await client.getCsrfToken();
try {
  const r = await client.rawPost(`/sap/bw/modeling/${'trfn'}/${name.toLowerCase()}?action=lock`, '', {
    'activity_context': 'CREA',
    'Accept': accept,
    'x-csrf-token': csrf,
  });
  const handle = r.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  console.log('2) CREA-Lock (RSDS) -> OK, Handle:', handle);
  console.log('   Enqueue steht jetzt auf trfn/' + name.toLowerCase());
} catch (e) {
  console.log('2) CREA-Lock (RSDS) -> FEHLER:');
  console.log(e.message.split('\n').slice(0, 14).join('\n'));
}
