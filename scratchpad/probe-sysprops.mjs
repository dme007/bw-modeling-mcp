const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv } = await import(`${D}/bw-client.js`);
const c = createClientFromEnv();
const r = await c.rawGet('/sap/bw/modeling/repo/is/systeminfo', { Accept: 'application/xml' });
const props = [...r.body.matchAll(/<sysInfo:property name="([^"]+)" value="([^"]*)"/g)];
console.log(`${props.length} sysInfo-Properties gesamt.\n`);
console.log('Alle mit "system."-Praefix oder SID-verdaechtigem Wert:');
for (const [, n, v] of props) {
  if (n.startsWith('system.') || n.includes('sid') || n.includes('logsys') || /^DBZ/i.test(v)) {
    console.log(`   ${n.padEnd(34)} = ${v}`);
  }
}
