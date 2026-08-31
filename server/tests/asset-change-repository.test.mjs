import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "canvas-asset-change-repository-"));
process.env.CANVAS_ASSET_CHANGE_DB_PATH = join(testDir, "asset-changes.sqlite");

try {
    const { appendAssetChangeRecord, initializeAssetChangeRepository, listAssetChangeRecords } = await import(`../lib/asset-change-repository.js?migration=${Date.now()}`);
    initializeAssetChangeRepository([{ id: "legacy_change", userId: "u1", revision: 1, source: "mutation", operations: [{ type: "delete_asset", id: "old" }], createdAt: "2026-08-26T00:00:00.000Z" }]);
    appendAssetChangeRecord({ id: "new_change", userId: "u1", revision: 2, source: "mutation", operations: [{ type: "upsert_folder", folder: { id: "f1", name: "F1" } }], createdAt: "2026-08-26T00:01:00.000Z" });
    appendAssetChangeRecord({ id: "duplicate_revision", userId: "u1", revision: 2, source: "mutation", operations: [], createdAt: "2026-08-26T00:02:00.000Z" });
    const changes = listAssetChangeRecords("u1", 0, 10);
    assert.equal(changes.length, 2);
    assert.equal(changes[0].id, "legacy_change");
    assert.equal(changes[1].id, "new_change");
    assert.deepEqual(listAssetChangeRecords("u2", 0, 10), []);
    console.log(JSON.stringify({ ok: true, legacyMigration: true, idempotentRevision: true, workspaceScoped: true }));
} finally {
    await rm(testDir, { recursive: true, force: true });
}
