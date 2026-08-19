const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv } = await import(`${D}/bw-client.js`);
const c = createClientFromEnv();
for (const p of ['/sap/bw/modeling/repo/is/systeminfo', '/sap/bw/modeling/discovery']) {
  try {
    const r = await c.rawGet(p, { Accept: 'application/xml' });
    console.log(`--- ${p} -> OK (${r.body.length} Bytes)`);
    if (p.includes('systeminfo')) console.log(r.body.slice(0, 900));
  } catch (e) {
    console.log(`--- ${p} -> FEHLER:`, e.message.split('\n')[0]);
  }
}
