import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { BwClient } from '../dist/bw-client.js';
import { bwDelete, datasourceKey } from '../dist/tools/delete.js';

// A DataSource is identified by its name plus source system. bw_delete takes the two as
// separate arguments or as the compound key a transport request shows, and addresses the
// DataSource on /rsds/{name}/{source system}.

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
const BASE = '/sap/bw/modeling/rsds/zds1/LSYS';
const backend = (deleteAnswer) => (call) => {
  if (/action=lock\b/.test(call.url)) return { data: '<LOCK_HANDLE>H1</LOCK_HANDLE>' };
  if (call.method === 'DELETE') return deleteAnswer;
  return { headers: { 'x-csrf-token': 'tok' }, data: '' };
};
const onDatasource = (calls) => calls.filter((c) => c.url.startsWith('/sap/bw/modeling/rsds/'));

test('name and source system given separately', () => {
  assert.deepEqual(datasourceKey('zds1', 'lsys'), { name: 'ZDS1', sourceSystem: 'LSYS' });
});

test('the compound key of a transport request: name padded to 30 characters, then the source system', () => {
  assert.deepEqual(datasourceKey('ZDS1'.padEnd(30, ' ') + 'LSYS'), { name: 'ZDS1', sourceSystem: 'LSYS' });
});

test('a single blank between name and source system is enough', () => {
  assert.deepEqual(datasourceKey('ZDS1 LSYS'), { name: 'ZDS1', sourceSystem: 'LSYS' });
});

test('compound key and source_system may both be given when they agree', () => {
  assert.deepEqual(datasourceKey('ZDS1'.padEnd(30, ' ') + 'LSYS', 'lsys'), { name: 'ZDS1', sourceSystem: 'LSYS' });
});

test('compound key and source_system that disagree are refused', () => {
  assert.throws(() => datasourceKey('ZDS1 LSYS', 'OTHER'), /names the source system LSYS, source_system says OTHER/);
});

test('a name without a source system is refused, and the error says what is missing', () => {
  assert.throws(() => datasourceKey('ZDS1'), /requires source_system/);
});

test('more than two parts are not a DataSource name', () => {
  assert.throws(() => datasourceKey('ZDS1 LSYS EXTRA'), /is not a DataSource name/);
});

test('lock and delete on /m, unlock without the version segment', () =>
  withAdapter(backend({ data: '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"/>' }), async (calls) => {
    const result = JSON.parse(await bwDelete(new BwClient(opts), 'rsds', 'ZDS1'.padEnd(30, ' ') + 'LSYS'));
    assert.deepEqual(
      { success: result.success, type: result.object_type, name: result.object_name, system: result.source_system },
      { success: true, type: 'RSDS', name: 'ZDS1', system: 'LSYS' },
    );
    const [lock, del, unlock] = onDatasource(calls);
    assert.equal(onDatasource(calls).length, 3);
    assert.equal(`${lock.method} ${lock.url}`, `POST ${BASE}/m?action=lock`);
    assert.equal(`${del.method} ${del.url}`, `DELETE ${BASE}/m?lockHandle=H1`);
    assert.equal(`${unlock.method} ${unlock.url}`, `POST ${BASE}?action=unlock`);
  }));

test('source_system as its own argument addresses the same resource', () =>
  withAdapter(backend({ data: '' }), async (calls) => {
    await bwDelete(new BwClient(opts), 'rsds', 'zds1', 'lsys');
    assert.equal(onDatasource(calls)[0].url, `${BASE}/m?action=lock`);
  }));

test('a refused delete still releases the lock', () =>
  withAdapter(backend({ status: 403, data: 'in use' }), async (calls) => {
    await assert.rejects(bwDelete(new BwClient(opts), 'rsds', 'ZDS1', 'LSYS'), /HTTP 403/);
    const last = onDatasource(calls).at(-1);
    assert.equal(`${last.method} ${last.url}`, `POST ${BASE}?action=unlock`);
  }));

test('without a source system nothing is sent', () =>
  withAdapter(backend({ data: '' }), async (calls) => {
    await assert.rejects(bwDelete(new BwClient(opts), 'rsds', 'ZDS1'), /requires source_system/);
    assert.equal(onDatasource(calls).length, 0);
  }));
