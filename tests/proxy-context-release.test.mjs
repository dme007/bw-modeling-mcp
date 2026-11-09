import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { BwClient, withSessionScope, sessionsClosed } from '../dist/bw-client.js';

// Behind a session-holding proxy every stateful request of the process runs in one context
// that outlives the tool calls. These tests pin when that context is ended: after a call
// that wrote in it, once no lock lives in it and no other call is running.

function withAdapter(handler, fn) {
  const calls = [];
  const prev = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    const headers = config.headers.toJSON ? config.headers.toJSON() : { ...config.headers };
    const call = { method: String(config.method).toUpperCase(), url: String(config.url ?? ''), headers };
    calls.push(call);
    const r = await handler(call, calls);
    return { status: r.status ?? 200, statusText: '', headers: r.headers ?? {}, data: r.data ?? '', config };
  };
  return fn(calls).finally(() => { axios.defaults.adapter = prev; });
}

// The context is kept per caller, so every test talks to a system of its own.
let system = 0;
const opts = () => ({
  url: `http://bw${++system}.test`,
  client: '201',
  auth: { kind: 'basic', user: 'u', password: 'p' },
  proxyContextIdGuard: true,
});

const ok = { status: 200, headers: { 'x-csrf-token': 'tok' }, data: '<x/>' };
const lockXml = { status: 200, headers: {}, data: '<LOCK_HANDLE>H1</LOCK_HANDLE>' };
const icm = { status: 400, headers: { 'sap-err-id': 'ICMENOSESSION' }, data: '<html>ICMENOSESSION</html>' };
const backend = (call) => (/action=lock\b/.test(call.url) ? lockXml : ok);

const RELEASE_PATH = '/sap/bw/modeling/repo/is/systeminfo';
const isRelease = (call) =>
  call.method === 'HEAD' && call.url === RELEASE_PATH && call.headers['X-sap-adt-sessiontype'] === 'stateless';
const releases = (calls) => calls.filter(isRelease);

async function toolCall(fn) {
  const result = await withSessionScope(fn);
  await sessionsClosed();
  return result;
}

test('a call that locked and unlocked ends the context: stateless HEAD without the guard cookie', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(async () => {
      await c.lock('adso', 'ZA');
      await c.unlock('adso', 'ZA');
    });
    const sent = releases(calls);
    assert.equal(sent.length, 1);
    assert.equal(calls[calls.length - 1], sent[0]);
    assert.equal(sent[0].headers.Cookie ?? sent[0].headers.cookie, undefined);
    assert.ok(sent[0].headers.Authorization);
  }));

test('a call that only read leaves the context alone', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(() => c.get('/sap/bw/modeling/adso/za/m', 'application/xml'));
    assert.equal(releases(calls).length, 0);
  }));

test('a lock held across calls keeps the context until the call that releases it', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(() => c.lock('trfn', 'T1'));
    assert.equal(releases(calls).length, 0);
    await toolCall(() => c.get('/sap/bw/modeling/trfn/t1/m', 'application/xml'));
    assert.equal(releases(calls).length, 0);
    await toolCall(() => c.unlock('trfn', 'T1'));
    assert.equal(releases(calls).length, 1);
  }));

test('one of two locks released: the context stays for the other', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(async () => {
      await c.lock('adso', 'ZA');
      await c.lock('adso', 'ZB');
      await c.unlock('adso', 'ZA');
    });
    assert.equal(releases(calls).length, 0);
    await toolCall(() => c.unlock('adso', 'ZB'));
    assert.equal(releases(calls).length, 1);
  }));

test('raw locks count as well, whatever version segment or enqueue path they name', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(async () => {
      await c.rawPost('/sap/bw/modeling/dtpa/dtp_x/m?action=lock', '', { 'x-csrf-token': 'tok' });
      await c.rawPost('/sap/bw/modeling/comp/enq/ZQ?action=lock', '', { 'x-csrf-token': 'tok' });
    });
    assert.equal(releases(calls).length, 0);
    await toolCall(() => c.rawPost('/sap/bw/modeling/dtpa/dtp_x?action=unlock', '', { 'x-csrf-token': 'tok' }));
    assert.equal(releases(calls).length, 0);
    await toolCall(() => c.rawPost('/sap/bw/modeling/query/zq/a?action=unlock', '', { 'x-csrf-token': 'tok' }));
    assert.equal(releases(calls).length, 1);
  }));

test('a refused unlock leaves the lock on the list', () =>
  withAdapter((call) => (/action=unlock\b/.test(call.url) ? { status: 500, data: 'no' } : backend(call)), async (calls) => {
    const c = new BwClient(opts());
    await toolCall(async () => {
      await c.lock('adso', 'ZA');
      await c.unlock('adso', 'ZA').catch(() => {});
    });
    assert.equal(releases(calls).length, 0);
  }));

test('a delete takes the lock on its object off the list', () =>
  withAdapter((call) => (/action=unlock\b/.test(call.url) ? { status: 404, data: 'gone' } : backend(call)), async (calls) => {
    const c = new BwClient(opts());
    await toolCall(async () => {
      await c.rawPost('/sap/bw/modeling/adso/za/m?action=lock', '', { 'x-csrf-token': 'tok' });
      await c.rawDelete('/sap/bw/modeling/adso/za/m?lockHandle=H1', {});
      await c.rawPost('/sap/bw/modeling/adso/za?action=unlock', '', { 'x-csrf-token': 'tok' }).catch(() => {});
    });
    assert.equal(releases(calls).length, 1);
  }));

test('a write outside the modeling API does not touch the modeling context', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(() =>
      c.rawPost('/sap/bc/adt/oo/classes/zcl_x?_action=LOCK', '', { 'X-sap-adt-sessiontype': 'stateful' }));
    assert.equal(releases(calls).length, 0);
  }));

test('the context is ended only when the last running call is over', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient(opts());
    let finishOther;
    const other = withSessionScope(() => new Promise((resolve) => { finishOther = resolve; }));
    await toolCall(async () => {
      await c.lock('adso', 'ZA');
      await c.unlock('adso', 'ZA');
    });
    assert.equal(releases(calls).length, 0);
    finishOther();
    await other;
    await sessionsClosed();
    assert.equal(releases(calls).length, 1);
  }));

test('a stateful request waits for a release under way', () => {
  let answerRelease;
  const handler = (call) =>
    isRelease(call) ? new Promise((resolve) => { answerRelease = () => resolve({ status: 400 }); }) : backend(call);
  return withAdapter(handler, async (calls) => {
    const c = new BwClient(opts());
    await withSessionScope(async () => {
      await c.lock('adso', 'ZA');
      await c.unlock('adso', 'ZA');
    });
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    await pause();
    const before = calls.length;
    assert.ok(isRelease(calls[before - 1]));
    const next = c.lock('adso', 'ZB');
    await pause();
    assert.equal(calls.length, before);
    answerRelease();
    await next;
    await sessionsClosed();
    assert.ok(calls.length > before);
  });
});

test('an ICMENOSESSION heal forgets the locks of the context that ended', () => {
  let dead = false;
  const handler = (call) => {
    if (dead && call.method === 'GET' && call.headers.Cookie === undefined) { dead = false; return icm; }
    return backend(call);
  };
  return withAdapter(handler, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(() => c.lock('adso', 'ZA'));
    dead = true;
    await toolCall(() => c.get('/sap/bw/modeling/adso/zb/m', 'application/xml'));
    assert.equal(releases(calls).length, 0);
    await toolCall(async () => {
      await c.lock('adso', 'ZC');
      await c.unlock('adso', 'ZC');
    });
    assert.equal(releases(calls).length, 1);
  });
});

test('a release that got no answer is tried again after the next call', () => {
  let fail = true;
  const handler = (call) => {
    if (isRelease(call) && fail) { fail = false; throw new Error('socket hang up'); }
    return backend(call);
  };
  return withAdapter(handler, async (calls) => {
    const c = new BwClient(opts());
    await toolCall(async () => {
      await c.lock('adso', 'ZA');
      await c.unlock('adso', 'ZA');
    });
    await toolCall(() => c.get('/sap/bw/modeling/adso/za/m', 'application/xml'));
    assert.equal(releases(calls).length, 2);
  });
});

test('BW_SESSION_CLOSE=off keeps the context', () =>
  withAdapter(backend, async (calls) => {
    process.env.BW_SESSION_CLOSE = 'off';
    try {
      const c = new BwClient(opts());
      await toolCall(async () => {
        await c.lock('adso', 'ZA');
        await c.unlock('adso', 'ZA');
      });
      assert.equal(releases(calls).length, 0);
    } finally {
      delete process.env.BW_SESSION_CLOSE;
    }
  }));

test('guard off: no release request', () =>
  withAdapter(backend, async (calls) => {
    const c = new BwClient({ ...opts(), proxyContextIdGuard: false });
    await toolCall(async () => {
      await c.lock('adso', 'ZA');
      await c.unlock('adso', 'ZA');
    });
    assert.equal(releases(calls).length, 0);
  }));
