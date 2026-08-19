// Cleanup: Unlock auf die beiden im Test gelockten transienten TRFNs.
const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv } = await import(`${D}/bw-client.js`);

const TRFNS = [
  '0mditmsmxzkxsjg98ghdx6s2bhg1y6qt', // YT_FIS010 -> YP_FIS010
  '026mjue4ei8m41pt201jgzyhxrwuxb5b', // ZI_B12_ACDOCA (RSDS) -> YT_FIS010
];

for (const t of TRFNS) {
  const client = createClientFromEnv();
  await client.loadMediaTypes();
  try {
    await client.unlock('trfn', t);
    console.log(`unlock trfn/${t} -> meldet Erfolg`);
  } catch (e) {
    console.log(`unlock trfn/${t} -> FEHLER:`, e.message.split('\n').slice(0, 4).join(' | '));
  }
}
