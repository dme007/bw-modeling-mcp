// READ-ONLY Diagnose: läuft loadMediaTypes(), was setzt es, und greift der Wert?
// Importreihenfolge exakt wie in dist/index.js: tools/adso.js VOR der Discovery.
const D = '/home/user/projects/bw-modeling-mcp/dist';

const adsoMod = await import(`${D}/tools/adso.js`);          // snapshottet ADSO_ACCEPT beim Import
const { createClientFromEnv, MEDIA_TYPES } = await import(`${D}/bw-client.js`);

console.log('1) MEDIA_TYPES.adso VOR Discovery :', MEDIA_TYPES['adso']);

const client = createClientFromEnv();

try {
  await client.loadMediaTypes();
  console.log('2) loadMediaTypes(): OK');
} catch (e) {
  console.log('2) loadMediaTypes(): FEHLER ->', e.message);
}
console.log('3) MEDIA_TYPES.adso NACH Discovery:', MEDIA_TYPES['adso']);

// A) Direkter GET mit dem *aktuellen* MEDIA_TYPES-Wert
try {
  const r = await client.get('/sap/bw/modeling/adso/yp_fis008/m', MEDIA_TYPES['adso']);
  console.log('4) direkter GET mit MEDIA_TYPES.adso -> OK, Bytes:', String(r.body ?? r).length);
} catch (e) {
  console.log('4) direkter GET mit MEDIA_TYPES.adso -> FEHLER:', e.message.split('\n')[0]);
}

// B) Der echte Tool-Pfad, der ADSO_ACCEPT (Snapshot) benutzt
try {
  const t = await adsoMod.bwGetAdso(client, 'YP_FIS008', 'text');
  console.log('5) bwGetAdso() Tool-Pfad -> OK, Bytes:', t.length);
} catch (e) {
  console.log('5) bwGetAdso() Tool-Pfad -> FEHLER:', e.message.split('\n')[0]);
}
