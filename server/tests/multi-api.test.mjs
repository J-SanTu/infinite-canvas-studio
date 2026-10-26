import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const root = await mkdtemp(join(tmpdir(), 'santu-multi-api-'));
for (const [name, file] of Object.entries({ CANVAS_DB_PATH: 'db.json', CANVAS_SECRET_PATH: 'secret.key', CANVAS_STORAGE_PATH: 'storage', CANVAS_IMAGE_USAGE_DB_PATH: 'usage.sqlite', CANVAS_IMAGE_USAGE_OUTBOX_PATH: 'outbox.ndjson', CANVAS_ASSET_CHANGE_DB_PATH: 'changes.sqlite', CANVAS_LOG_PATH: 'logs' })) process.env[name] = join(root, file);
const calls = [];
let ids = ['shared-chat', 'alpha-chat', 'gpt-image-test'];
const upstreams = [];
for (const provider of ['A', 'B']) {
    const server = createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        calls.push({ provider, path: req.url, auth: req.headers.authorization, google: req.headers['x-goog-api-key'], body });
        res.setHeader('Content-Type', 'application/json');
        if (req.url.endsWith('/models')) res.end(JSON.stringify(req.url.includes('v1beta') ? { models: ids.map(id => ({ name: 'models/' + id })) } : { data: ids.map(id => ({ id })) }));
        else res.end(JSON.stringify({ provider }));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    upstreams.push(server);
}
const base = (index) => `http://127.0.0.1:${upstreams[index].address().port}/v1`;
const { startServer, stopServer } = await import('../../server.js');
let local = await startServer({ host: '127.0.0.1', port: 0 });
const request = (path, method = 'GET', body) => fetch(local.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const save = async (input, cap = 'text') => { const r = await request(`/api/settings/apis/${cap}`, 'PUT', input); assert.equal(r.status, 200); return (await r.json()).config; };
const call = (id, model = 'shared-chat') => request(`/api/ai/channels/${id}/v1/chat/completions`, 'POST', { model, messages: [] });
test.after(async () => { await stopServer(); await Promise.all(upstreams.map(server => new Promise(resolve => server.close(resolve)))); await rm(root, { recursive: true, force: true }); });

test('legacy default survives adding channels, encrypted one-time backup and public settings contain no credentials', async () => {
    await save({ name: 'Legacy', baseUrl: base(0), apiKey: 'fixture-legacy-key' });
    const before = await readFile(process.env.CANVAS_DB_PATH, 'utf8');
    const result = await save({ create: true, channelId: 'channel-b', name: 'Qwen', baseUrl: base(1), apiKey: 'fixture-qwen-key' });
    assert.equal(result.channels.length, 2);
    assert.equal(result.channels[0].id, 'text-default');
    assert.equal(result.channels[0].textProtocol, 'responses');
    assert.equal(result.channels[1].textProtocol, 'chat');
    assert.deepEqual(JSON.parse(await readFile(process.env.CANVAS_DB_PATH + '.pre-multi-api.bak', 'utf8')), JSON.parse(before));
    assert.equal((await stat(process.env.CANVAS_DB_PATH + '.pre-multi-api.bak')).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(result), /fixture-|encryptedApiKey/);
    assert.doesNotMatch(await readFile(process.env.CANVAS_DB_PATH, 'utf8'), /fixture-/);
});
test('same named model routes to the correct provider and key, default route remains usable', async () => {
    assert.equal((await call('channel-b')).status, 200);
    assert.equal(calls.at(-1).provider, 'B'); assert.equal(calls.at(-1).auth, 'Bearer fixture-qwen-key');
    assert.equal(JSON.parse(calls.at(-1).body).model, 'shared-chat');
    assert.equal((await call('text-default')).status, 200);
    assert.equal(calls.at(-1).provider, 'A'); assert.equal(calls.at(-1).auth, 'Bearer fixture-legacy-key');
    assert.equal((await request('/api/ai/v1/responses', 'POST', { model: 'shared-chat' })).status, 200);
    const catalog = await (await request('/api/models/catalog?capability=text')).json();
    assert(catalog.models.some(m => m.id === 'channel-b::shared-chat'));
});
test('batch changes affect one channel only, reject invented models, refresh preserves selections', async () => {
    const result = await save({ channelId: 'channel-b', selectedModels: ['alpha-chat'] });
    assert(result.channels[0].models.includes('shared-chat'));
    assert.deepEqual(result.channels[1].models, ['alpha-chat']);
    assert.equal((await call('channel-b')).status, 409);
    assert.equal((await call('text-default')).status, 200);
    assert.equal((await request('/api/settings/apis/text', 'PUT', { channelId: 'channel-b', selectedModels: ['invented'] })).status, 400);
    ids = [...ids, 'new-chat'];
    const refreshed = await (await request('/api/settings/apis/text/models/refresh?channelId=channel-b', 'POST')).json();
    assert.deepEqual(refreshed.config.channels.find(c => c.id === 'channel-b').models, ['alpha-chat']);
    await save({ channelId: 'channel-b', selectedModels: [] });
    const empty = await (await request('/api/settings/apis/text/models/refresh?channelId=channel-b', 'POST')).json();
    assert.deepEqual(empty.config.channels.find(c => c.id === 'channel-b').models, []);
    await save({ channelId: 'channel-b', selectedModels: ['shared-chat'] });
});
test('restart retains both encrypted channels and selected models', async () => {
    await stopServer(); local = await startServer({ host: '127.0.0.1', port: 0 });
    assert.equal((await call('channel-b')).status, 200);
    assert.equal(calls.at(-1).auth, 'Bearer fixture-qwen-key');
    assert.equal((await call('text-default')).status, 200);
});
test('unknown, deleted, or wrong-capability channels never fall back to other credentials', async () => {
    await save({ baseUrl: base(0), apiKey: 'fixture-image-key' }, 'image');
    let before = calls.length;
    assert.equal((await call('missing')).status, 503); assert.equal(calls.length, before);
    assert.equal((await request('/api/ai/channels/channel-b/v1/images/generations', 'POST', { model: 'gpt-image-test' })).status, 503);
    assert.equal(calls.length, before);
    await save({ channelId: 'channel-b', clear: true });
    assert.equal((await call('channel-b')).status, 503);
    assert.equal(calls.length, before);
    assert.equal((await request('/api/settings/apis/text', 'PUT', { channelId: 'channel-b', baseUrl: base(1), apiKey: 'fixture-qwen-key' })).status, 400);
    assert.equal((await call('text-default')).status, 200);
});
test('deleting original default preserves additional channels and Gemini gets its own header and model validation', async () => {
    await save({ create: true, channelId: 'channel-g', name: 'Gemini', baseUrl: base(1).replace('/v1', '/v1beta'), apiKey: 'fixture-gemini-key', apiFormat: 'gemini' });
    const result = await save({ channelId: 'text-default', clear: true });
    assert.equal(result.channels.length, 1);
    assert.equal(result.channels[0].id, 'channel-g');
    assert.equal((await call('text-default')).status, 503);
    const r = await request('/api/ai/channels/channel-g/v1beta/models/shared-chat:streamGenerateContent?alt=sse', 'POST', { contents: [] });
    assert.equal(r.status, 200);
    assert.equal(calls.at(-1).google, 'fixture-gemini-key'); assert.equal(calls.at(-1).auth, undefined);
    assert.equal(calls.at(-1).path, '/v1beta/models/shared-chat:streamGenerateContent?alt=sse');
    assert.equal((await request('/api/ai/channels/channel-g/v1beta/models/unknown:generateContent', 'POST', {})).status, 409);
    const backup = JSON.parse(await readFile(process.env.CANVAS_DB_PATH + '.pre-multi-api.bak', 'utf8'));
    assert.equal(backup.apiConfigs.text.name, 'Legacy');
    assert(!backup.apiConfigs.text.channels?.length);
});
