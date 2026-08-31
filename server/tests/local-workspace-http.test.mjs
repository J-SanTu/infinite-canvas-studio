import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataRoot = await mkdtemp(join(tmpdir(), "santu-local-workspace-"));
process.env.CANVAS_DB_PATH = join(dataRoot, "app-db.json");
process.env.CANVAS_STORAGE_PATH = join(dataRoot, "storage");
process.env.CANVAS_SECRET_PATH = join(dataRoot, "api-secret.key");
process.env.CANVAS_IMAGE_USAGE_DB_PATH = join(dataRoot, "image-usage.sqlite");
process.env.CANVAS_IMAGE_USAGE_OUTBOX_PATH = join(dataRoot, "image-usage-outbox.ndjson");
process.env.CANVAS_ASSET_CHANGE_DB_PATH = join(dataRoot, "asset-changes.sqlite");

const upstream = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, path: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") }));
});
await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
});
const upstreamPort = upstream.address().port;

const { startServer, stopServer } = await import(`../../server.js?local-workspace=${Date.now()}`);
const local = await startServer({ port: 0, host: "127.0.0.1" });

test.after(async () => {
    await stopServer();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dataRoot, { recursive: true, force: true });
});

test("production server exposes the local workspace and built SPA without login", async () => {
    const health = await fetch(`${local.url}/api/health`);
    assert.equal(health.status, 200);

    const workspace = await fetch(`${local.url}/api/workspace`).then((response) => response.json());
    assert.equal(workspace.workspace.id, "local");
    assert.equal(workspace.workspace.role, "local");

    const root = await fetch(local.url);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type"), /text\/html/);
    assert.match(await root.text(), /<div id="root"><\/div>/);

    const deepLink = await fetch(`${local.url}/canvas/example`);
    assert.equal(deepLink.status, 200);
    assert.match(await deepLink.text(), /<div id="root"><\/div>/);

    assert.equal((await fetch(`${local.url}/assets/missing.js`)).status, 404);

    assert.equal((await fetch(`${local.url}/api/auth/login`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${local.url}/api/admin/users`)).status, 404);
});

test("API settings stay local, hide secrets, and drive the AI proxy", async () => {
    const savedResponse = await fetch(`${local.url}/api/settings/apis/text`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: `http://127.0.0.1:${upstreamPort}`, apiKey: "local-secret-key", models: ["local-text-model"] }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.config.configured, true);
    assert.equal(Object.hasOwn(saved.config, "apiKey"), false);
    assert.equal(saved.config.models[0], "local-text-model");

    const settingsText = await fetch(`${local.url}/api/settings/apis`).then((response) => response.text());
    assert.doesNotMatch(settingsText, /local-secret-key/);

    const proxied = await fetch(`${local.url}/api/ai/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Canvas-Capability": "text" },
        body: JSON.stringify({ model: "local-text-model", input: "hello" }),
    }).then((response) => response.json());
    assert.equal(proxied.ok, true);
    assert.equal(proxied.authorization, "Bearer local-secret-key");

    const database = JSON.parse(await readFile(process.env.CANVAS_DB_PATH, "utf8"));
    assert.deepEqual(
        database.users.map((user) => user.id),
        ["local"],
    );
    assert.equal(database.sessions.length, 0);
    assert.doesNotMatch(JSON.stringify(database), /local-secret-key/);
});
