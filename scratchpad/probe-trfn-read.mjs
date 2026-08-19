const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv, MEDIA_TYPES, freshRead } = await import(`${D}/bw-client.js`);
const c = createClientFromEnv();
await c.loadMediaTypes();
const r = await freshRead('/sap/bw/modeling/trfn/0gl5jsgrx9srsnq7hd5qx832k7chnuu9/m', MEDIA_TYPES['trfn']);
const head = r.body.slice(0, 1800);
console.log(head);
