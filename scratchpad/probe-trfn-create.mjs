// Verifikation des Fixes: bwCreateTransformation ueber den echten Tool-Pfad.
// ACHTUNG: legt live an. Paket $TMP, Transportzuordnung erfolgt separat.
const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv } = await import(`${D}/bw-client.js`);
const trfn = await import(`${D}/tools/transformation.js`);

const client = createClientFromEnv();
await client.loadMediaTypes();

const args = JSON.parse(process.argv[2]);
console.log('Anlage:', JSON.stringify(args));

try {
  const res = await trfn.bwCreateTransformation(client, args);
  console.log('-> OK:', res);
} catch (e) {
  console.log('-> FEHLER:', e.message.split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}
