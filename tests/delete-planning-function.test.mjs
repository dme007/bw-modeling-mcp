import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { BwClient } from '../dist/bw-client.js';
import { bwDelete } from '../dist/tools/delete.js';

// A planning function exists in the active version only. Its delete has to lock, delete and
// unlock on /plse/{name}/a: on the /m path the lock is granted, the delete refused, and the
// unlock without a version segment answers 404, so the lock stays.

function withAdapter(handler, fn) {
  const calls = [];
  const prev = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    const headers = config.headers.toJSON ? config.headers.toJSON() : { ...config.headers };
    const call = { method: String(config.method).toUpperCase(), url: String(config.url ?? ''), headers };
    calls.push(call);
    const r = handler(call);
    return { status: r.status ?? 200, statusText: '', headers: r.headers ?? {}, data: r.data ?? '', config };
  };
  return fn(calls).finally(() => { axios.defaults.adapter = prev; });
}

const opts = { url: 'http://bw.test', client: '100', auth: { kind: 'basic', user: 'u', password: 'p' } };
const PATH = '/sap/bw/modeling/plse/zpf1/a';
const deleted =
  '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Deleting planning function ZPF1</atom:title>' +
  '<atom:entry><atom:title>PLSE ZPF1 deleted</atom:title></atom:entry></atom:feed>';
const bare403 =
  '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Deleting planning function ZPF1</atom:title></atom:feed>';
const reason403 =
  '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:title>Still in use</atom:title></atom:entry></atom:feed>';

const backend = (deleteAnswer) => (call) => {
  if (/action=lock\b/.test(call.url)) return { data: '<LOCK_HANDLE>H1</LOCK_HANDLE>' };
  if (call.method === 'DELETE') return deleteAnswer;
  return { headers: { 'x-csrf-token': 'tok' }, data: '' };
};
const modeling = (calls) => calls.filter((c) => c.url.startsWith('/sap/bw/modeling/plse/'));

test('a planning function is locked, deleted and unlocked on its active path', () =>
  withAdapter(backend({ data: deleted }), async (calls) => {
    const result = JSON.parse(await bwDelete(new BwClient(opts), 'plse', 'ZPF1'));
    assert.equal(result.success, true);
    assert.equal(result.object_type, 'PLSE');
    const [lock, del, unlock] = modeling(calls);
    assert.equal(modeling(calls).length, 3);
    assert.equal(`${lock.method} ${lock.url}`, `POST ${PATH}?action=lock`);
    assert.equal(lock.headers.activity_context, 'DELE');
    assert.equal(`${del.method} ${del.url}`, `DELETE ${PATH}?lockHandle=H1`);
    assert.equal(`${unlock.method} ${unlock.url}`, `POST ${PATH}?action=unlock`);
  }));

test('a refused delete still releases the lock on the path it was taken on', () =>
  withAdapter(backend({ status: 403, data: bare403 }), async (calls) => {
    await assert.rejects(bwDelete(new BwClient(opts), 'plse', 'ZPF1'), /HTTP 403/);
    const last = modeling(calls).at(-1);
    assert.equal(`${last.method} ${last.url}`, `POST ${PATH}?action=unlock`);
  }));

test('a 403 without a message is explained as a missing delete authorization', () =>
  withAdapter(backend({ status: 403, data: bare403 }), async () => {
    await assert.rejects(bwDelete(new BwClient(opts), 'plse', 'ZPF1'), /S_RS_PLSE, activity 06/);
  }));

test('a 403 that names its reason is passed on as it is', () =>
  withAdapter(backend({ status: 403, data: reason403 }), async () => {
    await assert.rejects(bwDelete(new BwClient(opts), 'plse', 'ZPF1'), (err) => {
      assert.match(err.message, /Still in use/);
      assert.doesNotMatch(err.message, /S_RS_PLSE/);
      return true;
    });
  }));
