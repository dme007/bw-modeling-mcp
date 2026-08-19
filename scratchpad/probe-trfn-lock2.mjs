// STUFE 2 — Hypothese: der 423 kommt von einem Lock-Ueberrest, nicht von den Headern.
// A) unlock() auf die soeben gelockte TRFN versuchen (Defekt A: wirkt vermutlich nicht)
// B) danach denselben CREA-Lock erneut ziehen -> 423 == Defekt B reproduziert
const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv, MEDIA_TYPES } = await import(`${D}/bw-client.js`);

const TRFN = '0MDITMSMXZKXSJG98GHDX6S2BHG1Y6QT';
const trfnLower = TRFN.toLowerCase();
const SRC = { type: 'ADSO', name: 'YT_FIS010' };
const TGT = { type: 'ADSO', name: 'YP_FIS010' };

const client = createClientFromEnv();
await client.loadMediaTypes();
const accept = MEDIA_TYPES['trfn'];

// A) Lock loesen versuchen (frische Session, so wie es auch bw_unlock als Tool taete)
try {
  await client.unlock('trfn', trfnLower);
  console.log('A) unlock() -> meldet Erfolg');
} catch (e) {
  console.log('A) unlock() -> FEHLER:', e.message.split('\n').slice(0, 4).join(' | '));
}

// B) Erneuter Lock-Versuch, exakt derselbe Weg wie in transformation.ts
const transientPath =
  `/sap/bw/modeling/trfn/8transient?GetIdOnly=true` +
  `&sourceobjecttype=${SRC.type}&targetobjecttype=${TGT.type}` +
  `&sourceobjectname=${SRC.name}&targetobjectname=${TGT.name}`;
const { body } = await client.get(transientPath, accept);
const name2 = body.match(/\bname="([^"]+)"/)?.[1]?.toUpperCase();
console.log('B1) 8TRANSIENT liefert jetzt:', name2, name2 === TRFN ? '(identisch)' : '(ABWEICHEND!)');

const csrf = await client.getCsrfToken();
try {
  const r = await client.rawPost(`/sap/bw/modeling/trfn/${name2.toLowerCase()}?action=lock`, '', {
    'activity_context': 'CREA',
    'Accept': accept,
    'x-csrf-token': csrf,
  });
  const handle = r.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  console.log('B2) 2. Lock -> OK, Handle:', handle, '=> kein Ueberrest, Hypothese widerlegt');
} catch (e) {
  console.log('B2) 2. Lock -> FEHLER:');
  console.log(e.message.split('\n').slice(0, 12).join('\n'));
}
