// MESSUNG (keine Codeaenderung, kein Write ausser einem CREA-Lock):
// Stellt der Backend-Pfad ueberhaupt eine wiederauffindbare stateful Session aus?
// Beobachtet wird ausschliesslich, welche Cookies zurueckkommen.
const D = '/home/user/projects/bw-modeling-mcp/dist';
const { createClientFromEnv, MEDIA_TYPES } = await import(`${D}/bw-client.js`);

const show = (label, resHeaders, jar) => {
  const sc = resHeaders?.['set-cookie'] ?? [];
  const ctx = sc.filter(c => c.startsWith('sap-contextid'));
  const ctxVal = ctx.map(c => c.split(';')[0].split('=')[1]);
  const deleted = ctx.some(c => /expires=[^;]*19[78]0/i.test(c));
  console.log(`\n${label}`);
  console.log(`   Set-Cookie Namen : ${sc.map(c => c.split('=')[0]).join(', ') || '(keine)'}`);
  console.log(`   sap-contextid    : ${ctx.length ? `${ctxVal.join('/')} ${deleted ? '(LOESCHUNG)' : '(WERT!)'}` : '(nicht gesendet)'}`);
  console.log(`   Jar danach       : ${Object.keys(jar).join(', ')}`);
  const arbe = jar['ARBE'];
  if (arbe) console.log(`   ARBE-Praefix     : ${arbe.slice(0, 24)}`);
};

const client = createClientFromEnv();
await client.loadMediaTypes();

// A) Normaler GET ueber this.http — dessen axios-Defaults enthalten bereits
//    X-sap-adt-sessiontype: stateful
let r = await client.rawGet('/sap/bw/modeling/repo/is/systeminfo', { Accept: 'application/xml' });
show('A) GET systeminfo (Default-Header: stateful)', r.headers, client.sessionInfo());

// B) Zweiter identischer GET — wandert der ARBE-Cookie?
r = await client.rawGet('/sap/bw/modeling/repo/is/systeminfo', { Accept: 'application/xml' });
show('B) GET systeminfo, zweiter Aufruf', r.headers, client.sessionInfo());

// C) 8TRANSIENT (wie im Create-Flow)
const accept = MEDIA_TYPES['trfn'];
const tp = `/sap/bw/modeling/trfn/8transient?GetIdOnly=true&sourceobjecttype=ADSO&targetobjecttype=ADSO&sourceobjectname=YT_FIS010&targetobjectname=YP_FIS010`;
const t = await client.get(tp, accept);
const name = t.body.match(/\bname="([^"]+)"/)?.[1];
show(`C) GET 8TRANSIENT -> ${name}`, t.headers, client.sessionInfo());

// D) CREA-Lock OHNE Session-Header (heutiger Code-Pfad)
const csrf = await client.getCsrfToken();
const lockPath = `/sap/bw/modeling/trfn/${name.toLowerCase()}?action=lock`;
try {
  const l = await client.rawPost(lockPath, '', {
    'activity_context': 'CREA', 'Accept': accept, 'x-csrf-token': csrf,
  });
  const h = l.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  show(`D) CREA-Lock OHNE sessiontype -> Handle ${h?.slice(0, 12)}…`, l.headers, client.sessionInfo());
} catch (e) { console.log('\nD) Lock -> FEHLER:', e.message.split('\n')[0]); }

// E) CREA-Lock MIT sessiontype: stateful — in frischer Session
const c2 = createClientFromEnv();
await c2.loadMediaTypes();
const csrf2 = await c2.getCsrfToken();
try {
  const l2 = await c2.rawPost(lockPath, '', {
    'activity_context': 'CREA', 'Accept': accept, 'x-csrf-token': csrf2,
    'X-sap-adt-sessiontype': 'stateful',
  });
  const h2 = l2.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  show(`E) CREA-Lock MIT sessiontype=stateful -> Handle ${h2?.slice(0, 12)}…`, l2.headers, c2.sessionInfo());

  // F) Folge-GET in DERSELBEN Session — bleibt der Kontext erhalten?
  const f = await c2.rawGet('/sap/bw/modeling/repo/is/systeminfo', { Accept: 'application/xml' });
  show('F) Folge-GET in derselben Session nach dem Lock', f.headers, c2.sessionInfo());
} catch (e) { console.log('\nE/F -> FEHLER:', e.message.split('\n').slice(0, 3).join(' | ')); }
