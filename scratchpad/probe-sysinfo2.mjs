const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv } = await import(`${D}/bw-client.js`);
const c = createClientFromEnv();
const r = await c.rawGet('/sap/bw/modeling/repo/is/systeminfo', { Accept: 'application/xml' });
// alle sysInfo:-Elemente zeigen
const tags = r.body.match(/<sysInfo:[^>]*>[^<]*/g) || [];
console.log('sysInfo-Elemente:'); tags.slice(0, 25).forEach(t => console.log('  ', t));
console.log('\nTreffer auf "DBZ":');
let i = r.body.indexOf('DBZ');
while (i !== -1 && i < r.body.length) { console.log('  …', r.body.slice(Math.max(0, i - 90), i + 20).replace(/\n/g, ' ')); i = r.body.indexOf('DBZ', i + 1); }
