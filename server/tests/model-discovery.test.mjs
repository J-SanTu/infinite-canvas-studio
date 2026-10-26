import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = await mkdtemp(join(tmpdir(), 'santu-model-discovery-'));
for (const [name, file] of Object.entries({ CANVAS_DB_PATH: 'db.json', CANVAS_SECRET_PATH: 'secret.key', CANVAS_STORAGE_PATH: 'storage', CANVAS_IMAGE_USAGE_DB_PATH: 'usage.sqlite', CANVAS_IMAGE_USAGE_OUTBOX_PATH: 'outbox.ndjson', CANVAS_ASSET_CHANGE_DB_PATH: 'changes.sqlite', CANVAS_LOG_PATH: 'logs' })) process.env[name] = join(root, file);
let mode = 'ok';
let ids = ['provider-text-v6', 'gpt-image-2', 'provider-text-v6'];
const calls = [];
const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, auth: req.headers.authorization, google: req.headers['x-goog-api-key'], body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/v1beta/models')) {
        res.end(JSON.stringify(req.url.includes('pageToken') ? { models: [{ name: 'models/provider-second' }] } : { models: [{ name: 'models/provider-first' }], nextPageToken: 'next' }));
    } else if (req.url.endsWith('/models')) {
        if (mode === 'denied') { res.statusCode = 401; res.end(JSON.stringify({ error: 'opaque-fixture-key' })); }
        else if (mode === 'malformed') res.end(JSON.stringify({ ok: true }));
        else res.end(JSON.stringify({ data: ids.map(id => ({ id })) }));
    } else res.end(JSON.stringify({ ok: true }));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
const { startServer, stopServer } = await import('../../server.js');
const { updateDb } = await import('../lib/store.js');
const local = await startServer({ host: '127.0.0.1', port: 0 });
const request = (path, method = 'GET', body) => fetch(local.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const save = async (capability, input) => (await request(`/api/settings/apis/${capability}`, 'PUT', input)).json();
const refresh = async () => (await request('/api/settings/apis/text/models/refresh', 'POST')).json();
test.after(async () => { await stopServer(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); });

test('empty install has no invented models; save discovers exact IDs with backend-only credentials', async () => {
    const empty = await (await request('/api/settings/apis')).json();
    assert.deepEqual(empty.apis.text.models, []);
    const saved = await save('text', { baseUrl, apiKey: 'opaque-fixture-key', models: ['invented-model'] });
    assert.equal(saved.config.modelsStatus, 'ready');
    assert.deepEqual(saved.config.availableModels, ['provider-text-v6', 'gpt-image-2']);
    assert.deepEqual(saved.config.models, ['provider-text-v6']);
    assert.equal(calls.at(-1).path, '/v1/models');
    assert.equal(calls.at(-1).auth, 'Bearer opaque-fixture-key');
    assert.doesNotMatch(JSON.stringify(saved), /opaque-fixture-key|encryptedApiKey/);
    assert.doesNotMatch(await readFile(process.env.CANVAS_DB_PATH, 'utf8'), /opaque-fixture-key/);
    const catalog = await (await request('/api/models/catalog?capability=text')).json();
    assert.deepEqual(catalog.models.map(m => m.id), ['provider-text-v6']);
});

test('refresh replaces stale lists, preserves stored key, and blocks old canvas before upstream', async () => {
    ids = ['provider-text-next'];
    const next = await refresh();
    assert.deepEqual(next.config.models, []); // newly discovered models require explicit selection
    assert.deepEqual(next.config.availableModels, ids);
    await save('text', { selectedModels: ids });
    assert.equal(calls.at(-1).auth, 'Bearer opaque-fixture-key');
    const before = calls.length;
    const old = await request('/api/ai/v1/responses', 'POST', { model: 'provider-text-v6', input: 'test' });
    assert.equal(old.status, 409);
    assert.equal(calls.length, before);
    assert.equal((await request('/api/ai/v1/responses', 'POST', { model: 'provider-text-next', input: 'test' })).status, 200);
    assert.equal((await request('/api/settings/apis/text', 'PUT', { selectedModels: ['invented'] })).status, 400);
    assert.deepEqual((await save('text', { selectedModels: [] })).config.models, []);
    assert.deepEqual((await refresh()).config.models, []); // respect explicit deselection
    await save('text', { selectedModels: ids });
});

test('credential changes and discovery failures never retain old models or leak provider errors', async () => {
    mode = 'denied';
    const failed = await save('text', { baseUrl, apiKey: 'replacement-fixture-key' });
    assert.equal(failed.config.configured, true);
    assert.equal(failed.config.modelsStatus, 'error');
    assert.match(failed.config.modelsError, /401/);
    assert.deepEqual(failed.config.models, []);
    assert.deepEqual(failed.config.availableModels, []);
    assert.doesNotMatch(JSON.stringify(failed), /opaque-fixture-key|replacement-fixture-key/);
    assert.equal((await request('/api/ai/v1/responses', 'POST', { model: 'provider-text-next' })).status, 409);
    mode = 'malformed';
    assert.equal((await refresh()).config.modelsStatus, 'error');
    mode = 'ok'; ids = [];
    assert.equal((await refresh()).config.modelsStatus, 'error');
    ids = ['recovered-text'];
    assert.deepEqual((await refresh()).config.models, ids);
    assert.equal(calls.at(-1).auth, 'Bearer replacement-fixture-key');
});

test('legacy manual models are unverified until discovery; Tinify does not fetch models', async () => {
    await updateDb(db => { delete db.apiConfigs.text.modelsStatus; db.apiConfigs.text.models = ['gpt-5.5']; });
    const legacy = await (await request('/api/settings/apis')).json();
    assert.equal(legacy.apis.text.modelsStatus, 'unverified');
    assert.deepEqual(legacy.apis.text.models, []);
    assert.equal((await request('/api/ai/v1/responses', 'POST', { model: 'gpt-5.5' })).status, 409);
    assert.deepEqual((await refresh()).config.models, ['recovered-text']);
    const count = calls.length;
    assert.equal((await save('tinify', { apiKey: 'tinify-fixture-key' })).config.modelsStatus, 'not_required');
    assert.equal(calls.length, count);
});

test('Gemini uses header authentication and follows pagination without altering model IDs', async () => {
    const result = await save('text', { baseUrl: baseUrl.replace('/v1', ''), apiKey: 'google-fixture-key', apiFormat: 'gemini' });
    assert.deepEqual(result.config.models, ['provider-first', 'provider-second']);
    assert.equal(calls.at(-1).google, 'google-fixture-key');
    assert.equal(calls.at(-1).auth, undefined);
    assert.equal(calls.at(-1).path, '/v1beta/models?pageToken=next');
});
